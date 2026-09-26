"""POST /receipts: image -> Storage -> Document AI extract (synchronous, 60 s) -> editable fields.
POST /receipts/{id}/save: bill kind + settled -> entry type -> find_party -> decide_save."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from ..auth import CurrentUser, current_user
from ..db import admin_client, user_client
from ..errors import AppError
from ..ledger import check_uuid, now_iso, require_membership, rupees_to_paise, today_ist
from ..services import llm_router
from .entries import fetch_entry
from ..services.sarvam import client as sarvam

log = logging.getLogger("khata")
router = APIRouter()

EXT = {"image/jpeg": "jpg", "image/png": "png"}
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y",
                "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y", "%d-%b-%y")


def _parse_date(raw) -> str | None:
    s = str(raw or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _entry_type(kind: str, settled: bool | None) -> str:
    if kind == "supplier":
        return "purchase_paid" if settled else "purchase_credit"
    if kind == "customer":
        return "cash_sale" if settled else "credit_given"
    return "expense"


def _receipt(db, receipt_id: str) -> dict:
    check_uuid(receipt_id, "receipt")
    rows = db.table("receipts").select("*").eq("id", receipt_id).limit(1).execute().data
    if not rows:
        raise AppError(404, "not_found", "That receipt does not exist.")
    return rows[0]


def _out(r: dict) -> dict:
    return {"receipt_id": r["id"], "status": r["status"], "kind": r["kind"], "settled": r["settled"],
            "vendor_name": r["vendor_name"], "bill_date": r["bill_date"], "total_paise": r["total_paise"],
            "error": r["error"]}


@router.post("/receipts", status_code=201)
def create_receipt(image: UploadFile = File(...), kind: Literal["supplier", "customer", "expense"] = Form(...),
                   settled: bool | None = Form(None), user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id = m["shop_id"]
    if kind != "expense" and settled is None:
        raise AppError(422, "settled_required", "Choose Paid or Credit first.")
    mime = (image.content_type or "").split(";")[0]
    if mime not in EXT:
        raise AppError(422, "bad_image", "Use a JPG or PNG photo of the bill.")
    data = image.file.read()
    path = f"{shop_id}/{uuid.uuid4()}.{EXT[mime]}"
    admin_client().storage.from_("receipts").upload(path, data, {"content-type": mime})
    db = user_client(user.token)
    rec = db.table("receipts").insert({
        "shop_id": shop_id, "image_path": path, "kind": kind,
        "settled": None if kind == "expense" else settled, "ocr_lang_first": m["lang"],
        "status": "processing", "created_by": user.id}).execute().data[0]

    upd: dict
    try:
        raw = sarvam().extract_receipt(data, f"bill.{EXT[mime]}", mime, m["lang"])
        result = raw.get("result") or {}
        # Results may be keyed per page/document; take the first dict holding our fields.
        if "total" not in result:
            result = next((v for v in result.values() if isinstance(v, dict) and "total" in v), result)
        total = result.get("total")
        try:
            total_paise = round(float(str(total).replace(",", "")) * 100) if total not in (None, "") else None
        except ValueError:
            total_paise = None
        upd = {"status": "done", "sarvam_job_id": raw.get("job_id"), "raw_extract": raw,
               "vendor_name": (result.get("vendor_name") or None), "bill_date": _parse_date(result.get("bill_date")),
               "total_paise": total_paise}
        if total_paise is None:
            upd.update(status="failed", error="could not read the total")
    except AppError as e:
        upd = {"status": "failed", "error": e.message}
    except Exception as e:
        log.exception("receipt extract failed")
        upd = {"status": "failed", "error": f"Couldn't read that bill ({type(e).__name__}). Type the values below."}
    rec = db.table("receipts").update(upd).eq("id", rec["id"]).execute().data[0]
    return _out(rec)


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    return _out(_receipt(user_client(user.token), receipt_id))


class SaveReceipt(BaseModel):
    vendor_name: str | None = None
    bill_date: str | None = None
    total_rupees: float
    customer_name: str | None = None


@router.post("/receipts/{receipt_id}/save")
def save_receipt(receipt_id: str, body: SaveReceipt, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id = m["shop_id"]
    db = user_client(user.token)
    rec = _receipt(db, receipt_id)
    etype = _entry_type(rec["kind"], rec["settled"])
    vendor = (body.vendor_name or "").strip() or None
    amount_paise = rupees_to_paise(body.total_rupees)
    occurred_on = _parse_date(body.bill_date) or today_ist().isoformat()

    # Party: vendor for supplier bills (paid too, per §9b), customer name for udhaar, none otherwise.
    kind, name = None, None
    if rec["kind"] == "supplier":
        kind, name = "supplier", vendor
    elif etype == "credit_given":
        kind, name = "customer", (body.customer_name or "").strip() or None
    if kind and not name:
        raise AppError(422, "party_required",
                       "Enter the customer's name." if kind == "customer" else "Enter the supplier's name.")

    # decide_save skips party matching for purchase_paid, so match with a party type of the same kind.
    match_type = "purchase_credit" if kind == "supplier" else etype
    parsed = llm_router.ParsedEntry(type=match_type, party_name=name, amount_paise=amount_paise, note=None,
                                    occurred_on=occurred_on, needs_clarification=False,
                                    clarification_question=None)
    matches = db.rpc("find_party", {"p_shop": shop_id, "p_query": name, "p_kind": kind}).execute().data or [] \
        if kind else []
    d = llm_router.decide_save(parsed, matches)

    party_id = d.party_id
    if d.party_action == "ask_did_you_mean":
        party_id = matches[0]["party_id"]  # pending with the suggestion; CONFIRM = yes
    elif d.party_action == "create_flagged":
        party_id = db.table("parties").insert({"shop_id": shop_id, "kind": kind, "display_name": name,
                                               "name_latin": name.lower(), "needs_review": True}
                                              ).execute().data[0]["id"]

    auto = d.action == "auto"
    row = {"shop_id": shop_id, "party_id": party_id, "type": etype, "amount_paise": amount_paise,
           "note": vendor if etype in ("expense", "cash_sale") else None, "occurred_on": occurred_on,
           "status": "confirmed" if auto else "pending", "source": "receipt", "auto_saved": auto,
           "review_reason": d.reason, "receipt_id": receipt_id, "created_by": user.id}
    if auto:
        row.update(confirmed_by=user.id, confirmed_at=now_iso())
    entry = fetch_entry(db, db.table("entries").insert(row).execute().data[0]["id"])
    db.table("receipts").update({"vendor_name": vendor, "bill_date": _parse_date(body.bill_date),
                                 "total_paise": amount_paise}).eq("id", receipt_id).execute()
    return {"decision": d.action, "entry": entry, "suggestion": d.suggestion}
