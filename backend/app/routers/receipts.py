"""Receipts (CLAUDE.md §6.3).
POST /receipts: image → Storage → receipt row (queued) → returns {receipt_id} at once; OCR runs
  as a BackgroundTask (services/receipt_ocr.py: poll 2 s, 90 s, English retry, fallback).
GET /receipts/{id}: status + fields; the frontend polls it every 2 s.
POST /receipts/{id}/save: bill kind + settled → entry type → find_party → decide_save. One live
  entry per bill; saving by hand also takes a failed bill out of the review queue."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict

from ..auth import CurrentUser, current_user
from ..db import PG_UNIQUE_VIOLATION, user_client
from ..errors import AppError
from ..ratelimit import rate_limit
from ..ledger import (check_uuid, now_ist, now_iso, parse_iso_date, require_membership, rupees_to_paise,
                      today_ist)
from ..services import llm_router, receipt_ocr
from ..services.sarvam import client as sarvam
from ..storage import BILL_TYPES, MAX_PDF_PAGES, pdf_pages, read_upload, upload
from .entries import fetch_entry

log = logging.getLogger("khata")
router = APIRouter()

# Extract + English retry + fallback can take 3 × 90 s. A job still "running" after this was lost
# (e.g. the free Render instance restarted), so it is reported as failed and can be typed in.
STALE_AFTER_S = 300
# After 90 s of reading the scan screen offers "Type it in instead" (GOAL_2.0 P2.3): from then on
# the bill may be saved by hand even while the job still runs; the job's late result is then not
# written over what the user saved.
TYPE_IT_IN_AFTER_S = 90


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


def _stage(r: dict) -> str | None:
    """uploaded → reading → checking while the job runs; None once it has finished."""
    if r["status"] == "queued":
        return "uploaded"
    if r["status"] == "processing":
        return (r.get("raw_extract") or {}).get("stage") or "reading"
    return None


def _out(r: dict) -> dict:
    return {"receipt_id": r["id"], "status": r["status"], "stage": _stage(r), "kind": r["kind"], "settled": r["settled"],
            "created_at": r["created_at"], "file_type": "pdf" if str(r["image_path"]).endswith(".pdf") else "image",
            "vendor_name": r["vendor_name"], "bill_date": r["bill_date"], "total_paise": r["total_paise"],
            "retried_in_english": r["retried_in_english"], "error": r["error"],
            # GOAL_2.0 P1.3 / P2.4: what the bill says (Digitise text), and whether the total shown
            # is printed on it ("ok") or needs a look ("check").
            "ocr_text": r.get("ocr_text"), "total_check": (r.get("raw_extract") or {}).get("total_check")}


def _age_s(r: dict) -> float:
    created = datetime.fromisoformat(str(r["created_at"]).replace("Z", "+00:00"))
    return (now_ist() - created).total_seconds()


def _is_stale(r: dict) -> bool:
    return r["status"] in ("queued", "processing") and _age_s(r) > STALE_AFTER_S


def process_receipt(receipt_id: str, token: str, image: bytes, filename: str, mime: str, lang: str) -> None:
    """BackgroundTask. Runs as the uploading user (RLS applies)."""
    db = user_client(token)

    def stage(name: str) -> None:   # progress marker; replaced by the real output at the end
        db.table("receipts").update({"raw_extract": {"stage": name}}).eq("id", receipt_id).eq("status", "processing").execute()

    try:
        db.table("receipts").update({"status": "processing", "raw_extract": {"stage": "reading"}}
                                    ).eq("id", receipt_id).eq("status", "queued").execute()
        o = receipt_ocr.read_receipt(sarvam(), image, filename, mime, lang,
                                     fields_from_text=llm_router.receipt_fields, on_stage=stage)
        upd = {"status": o.status, "vendor_name": o.vendor_name, "bill_date": o.bill_date,
               "total_paise": o.total_paise, "retried_in_english": o.retried_in_english,
               "sarvam_job_id": o.job_ids[-1] if o.job_ids else None, "raw_extract": o.raw,
               "ocr_text": o.ocr_text, "error": o.error}
    except Exception:
        log.exception("receipt OCR crashed")
        upd = {"status": "failed", "error": "Couldn't read that bill. Type the values below."}
    try:
        # Only while still reading: if the user already typed it in and saved, their values stand.
        db.table("receipts").update(upd).eq("id", receipt_id).in_("status", ["queued", "processing"]).execute()
    except Exception:
        log.exception("could not store OCR result")


@router.post("/receipts", status_code=201, dependencies=[Depends(rate_limit("receipts"))])
def create_receipt(background: BackgroundTasks, image: UploadFile = File(...),
                   kind: Literal["supplier", "customer", "expense"] = Form(...),
                   settled: bool | None = Form(None), user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id = m["shop_id"]
    if kind != "expense" and settled is None:
        raise AppError(422, "settled_required",
                       "Choose Paid or Credit first." if kind == "supplier" else "Choose Cash or Udhaar first.")
    data, mime, ext = read_upload(image, BILL_TYPES, AppError(
        422, "bad_image", "Use a JPG or PNG photo, or a PDF, of the bill."))
    if mime == "application/pdf" and (pdf_pages(data) or 1) > MAX_PDF_PAGES:
        raise AppError(422, "pdf_pages", f"This PDF has {pdf_pages(data)} pages. Upload just the bill: a photo "
                                         "or a one-page PDF.")
    path = upload("receipts", shop_id, data, mime, ext)
    rec = user_client(user.token).table("receipts").insert({
        "shop_id": shop_id, "image_path": path, "kind": kind,
        "settled": None if kind == "expense" else settled, "ocr_lang_first": m["lang"],
        "status": "queued", "created_by": user.id}).execute().data[0]
    background.add_task(process_receipt, rec["id"], user.token, data, f"bill.{ext}", mime, m["lang"])
    return {"receipt_id": rec["id"], "status": rec["status"]}


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    r = _receipt(db, receipt_id)
    if _is_stale(r):
        r = db.table("receipts").update({"status": "failed", "error": "Reading the bill stopped. Type the values below."}
                                        ).eq("id", receipt_id).execute().data[0]
    return _out(r)


class SaveReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vendor_name: str | None = None
    bill_date: str | None = None
    total_rupees: float
    customer_name: str | None = None
    # The bill kind and Paid/Credit can still be changed on the review form (GOAL_2.0 P2.5).
    kind: Literal["supplier", "customer", "expense"] | None = None
    settled: bool | None = None


def _bill_date(raw: str | None) -> str | None:
    if raw in (None, ""):
        return None
    try:
        return parse_iso_date(raw, "bill date")
    except AppError:
        parsed = receipt_ocr.parse_date(raw)
        if not parsed:
            raise
        return parsed


@router.post("/receipts/{receipt_id}/save")
def save_receipt(receipt_id: str, body: SaveReceipt, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id = m["shop_id"]
    db = user_client(user.token)
    rec = _receipt(db, receipt_id)
    if rec["status"] in ("queued", "processing") and _age_s(rec) < TYPE_IT_IN_AFTER_S:
        raise AppError(409, "still_reading", "Still reading this bill. Wait a moment, then save.")
    if body.kind is not None:
        settled = None if body.kind == "expense" else body.settled
        if body.kind != "expense" and settled is None:
            raise AppError(422, "settled_required",
                           "Choose Paid or Credit first." if body.kind == "supplier" else "Choose Cash or Udhaar first.")
        rec = {**rec, "kind": body.kind, "settled": settled}
    live = (db.table("entries").select("id").eq("receipt_id", receipt_id).neq("status", "voided")
            .limit(1).execute().data)
    if live:
        raise AppError(409, "already_saved", "This bill is already saved. Open it from the ledger to change it.")

    etype = _entry_type(rec["kind"], rec["settled"])
    vendor = (body.vendor_name or "").strip() or None
    amount_paise = rupees_to_paise(body.total_rupees)
    bill_date = _bill_date(body.bill_date)
    occurred_on = bill_date or today_ist().isoformat()

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
        party_id = matches[0]["party_id"]  # pending with the suggestion; CONFIRM = yes, EDIT to change
    elif d.party_action == "create_flagged":
        party_id = db.table("parties").insert({"shop_id": shop_id, "kind": kind, "display_name": name,
                                               "name_latin": name.strip().lower(), "needs_review": True}
                                              ).execute().data[0]["id"]

    auto = d.action == "auto"
    row = {"shop_id": shop_id, "party_id": party_id, "type": etype, "amount_paise": amount_paise,
           "note": vendor if etype in ("expense", "cash_sale") else None, "occurred_on": occurred_on,
           "status": "confirmed" if auto else "pending", "source": "receipt", "auto_saved": auto,
           "review_reason": d.reason, "receipt_id": receipt_id, "created_by": user.id}
    if auto:
        row.update(confirmed_by=user.id, confirmed_at=now_iso())
    try:
        inserted = db.table("entries").insert(row).execute().data[0]
    except APIError as e:
        if e.code == PG_UNIQUE_VIOLATION:   # two taps at once: migration 002's index refused the second
            raise AppError(409, "already_saved", "This bill is already saved. Open it from the ledger to change it.") from e
        raise
    entry = fetch_entry(db, inserted["id"])
    # The typed values are what the bill says now; `done` takes a failed bill out of the review queue.
    db.table("receipts").update({"vendor_name": vendor, "bill_date": bill_date, "total_paise": amount_paise,
                                 "kind": rec["kind"], "settled": rec["settled"], "status": "done"}
                                ).eq("id", receipt_id).execute()
    return {"decision": d.action, "entry": entry, "suggestion": d.suggestion}
