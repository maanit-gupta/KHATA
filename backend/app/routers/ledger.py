"""GET /ledger and GET /ledger/export.csv (GOAL_2.0 P3.1, P3.3): the shopkeeper's whole book as a
table. Every filter runs in SQL (`ledger_rows`, security invoker, so RLS applies); the totals row
comes from `ledger_totals` over the same filters and counts confirmed entries only. Voided
entries appear only when the status filter asks for them."""

from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..errors import AppError
from ..ledger import (ENTRY_STATUSES, ENTRY_TYPES, IST, check_uuid, parse_iso_date, require_membership,
                      today_ist)
from ..members import name_map, who

router = APIRouter()

SOURCES = ("voice", "receipt", "manual")
PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
EXPORT_LIMIT = 10_000
TYPE_LABELS = {"credit_given": "Credit given", "payment_received": "Payment received", "cash_sale": "Cash sale",
               "purchase_credit": "Purchase on credit", "purchase_paid": "Purchase paid",
               "payment_made": "Payment made", "expense": "Expense"}
SOURCE_LABELS = {"voice": "Voice", "receipt": "Bill", "manual": "Typed"}


def _list(raw: str | None, allowed: tuple[str, ...], what: str) -> list[str] | None:
    if not raw:
        return None
    items = [x.strip() for x in raw.split(",") if x.strip()]
    bad = [x for x in items if x not in allowed]
    if bad:
        raise AppError(422, f"bad_{what}", f"Unknown {what}: {', '.join(bad)}.")
    return items or None


def filters(m: dict, date_from: str | None, date_to: str | None, type: str | None, party: str | None,
            source: str | None, member: str | None, status: str | None, q: str | None) -> dict:
    """The ledger_rows / ledger_totals parameters, validated."""
    f, t = parse_iso_date(date_from, "start date"), parse_iso_date(date_to, "end date")
    if f and t and f > t:
        raise AppError(422, "bad_range", "The start date is after the end date.")
    return {"p_shop": m["shop_id"], "p_from": f, "p_to": t,
            "p_types": _list(type, ENTRY_TYPES, "type"),
            "p_party": check_uuid(party, "party") if party else None,
            "p_sources": _list(source, SOURCES, "source"),
            "p_member": check_uuid(member, "member") if member else None,
            "p_statuses": _list(status, ENTRY_STATUSES, "status"),
            "p_q": (q or "").strip() or None}


def _row(r: dict, names: dict[str, str]) -> dict:
    return {**r, "added_by": who(names, r.get("created_by")), "confirmed_by_name": who(names, r.get("confirmed_by"))}


@router.get("/ledger")
def ledger(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to"),
           type: str | None = None, party: str | None = None, source: str | None = None, member: str | None = None,
           status: str | None = None, q: str | None = None, page: int = 1, page_size: int = PAGE_SIZE,
           user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    params = filters(m, date_from, date_to, type, party, source, member, status, q)
    page, size = max(page, 1), min(max(page_size, 1), MAX_PAGE_SIZE)
    start = (page - 1) * size
    totals = db.rpc("ledger_totals", params).execute().data[0]
    total_count = int(totals["row_count"])
    rows = []
    if start < total_count:   # past the last page PostgREST answers 416 (PGRST103); it's just empty
        rows = (db.rpc("ledger_rows", params).order("occurred_on", desc=True).order("created_at", desc=True)
                .order("id").range(start, start + size - 1).execute().data)
    names = name_map(db, m["shop_id"], user)
    return {"rows": [_row(r, names) for r in rows], "page": page, "page_size": size,
            "total_count": total_count, "pages": max(1, -(-total_count // size)),
            "totals": {k: totals[k] for k in ("cash_in_paise", "credit_given_paise", "collected_paise", "expenses_paise")},
            "members": [{"user_id": k, "name": v} for k, v in names.items()]}


def _rupees(paise: int) -> str:
    return f"{paise // 100}.{paise % 100:02d}"


def _ist(ts: str) -> str:
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(IST).strftime("%Y-%m-%d %H:%M")


@router.get("/ledger/export.csv")
def export_csv(date_from: str | None = Query(None, alias="from"), date_to: str | None = Query(None, alias="to"),
               type: str | None = None, party: str | None = None, source: str | None = None, member: str | None = None,
               status: str | None = None, q: str | None = None, user: CurrentUser = Depends(current_user)):
    """The same filtered view as a CSV: rupees with 2 decimals, dates and times in Asia/Kolkata."""
    m = require_membership(user)
    db = user_client(user.token)
    params = filters(m, date_from, date_to, type, party, source, member, status, q)
    rows = (db.rpc("ledger_rows", params).order("occurred_on", desc=True).order("created_at", desc=True)
            .order("id").limit(EXPORT_LIMIT).execute().data)
    names = name_map(db, m["shop_id"], user)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Date", "Party", "Type", "Amount (₹)", "Source", "Added by", "Status", "Note", "Recorded at (IST)"])
    for r in rows:
        w.writerow([r["occurred_on"], r["party_name"] or "", TYPE_LABELS[r["type"]], _rupees(r["amount_paise"]),
                    SOURCE_LABELS[r["source"]], who(names, r["created_by"]) or "", r["status"].capitalize(),
                    r["note"] or "", _ist(r["created_at"])])
    name = f"khata-ledger-{today_ist().isoformat()}.csv"
    # UTF-8 with a BOM so Excel shows ₹ and Indic names correctly.
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
