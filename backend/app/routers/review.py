"""GET /review: the review_queue view (pending entries, auto-created parties, failed receipts),
each row with the details the Review screen shows (DESIGN.md §6.10)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..ledger import ENTRY_SELECT, entry_out, require_membership

router = APIRouter()


@router.get("/review")
def review(user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    rows = (db.table("review_queue").select("*").eq("shop_id", m["shop_id"])
            .order("created_at", desc=True).execute().data)
    ids = {kind: [r["id"] for r in rows if r["item"] == kind] for kind in ("entry", "party", "receipt")}
    details: dict[str, dict] = {}
    if ids["entry"]:
        details |= {e["id"]: entry_out(e) for e in
                    db.table("entries").select(ENTRY_SELECT).in_("id", ids["entry"]).execute().data}
    if ids["party"]:
        details |= {p["party_id"]: p for p in
                    db.table("party_balances").select("*").in_("party_id", ids["party"]).execute().data}
    if ids["receipt"]:
        details |= {r["id"]: {k: r[k] for k in ("id", "kind", "settled", "vendor_name", "bill_date",
                                                 "total_paise", "error", "created_at")}
                    for r in db.table("receipts").select("*").in_("id", ids["receipt"]).execute().data}
    return {"rows": [{**r, "detail": details.get(r["id"])} for r in rows], "count": len(rows)}
