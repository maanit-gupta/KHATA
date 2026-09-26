from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..errors import AppError
from ..ledger import (ENTRY_SELECT, ENTRY_TYPES, NO_PARTY_TYPES, entry_out, not_found, now_iso,
                      party_kind_for, require_membership, today_ist)

router = APIRouter()


class NewEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[ENTRY_TYPES]  # type: ignore[valid-type]
    amount_rupees: float = Field(gt=0)
    party_id: str | None = None
    party_name: str | None = None
    note: str | None = None
    occurred_on: str | None = None


def get_or_create_party(db, shop_id: str, name: str, kind: str, needs_review: bool) -> str:
    latin = name.strip().lower()
    rows = (db.table("parties").select("id").eq("shop_id", shop_id).eq("kind", kind)
            .eq("name_latin", latin).limit(1).execute().data)
    if rows:
        return rows[0]["id"]
    return (db.table("parties").insert({"shop_id": shop_id, "kind": kind, "display_name": name.strip(),
                                        "name_latin": latin, "needs_review": needs_review})
            .execute().data[0]["id"])


def fetch_entry(db, entry_id: str) -> dict:
    rows = db.table("entries").select(ENTRY_SELECT).eq("id", entry_id).limit(1).execute().data
    if not rows:
        raise not_found()
    return entry_out(rows[0])


@router.get("/entries")
def list_entries(limit: int = 20, status: str | None = None, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    q = (user_client(user.token).table("entries").select(ENTRY_SELECT).eq("shop_id", m["shop_id"])
         .order("created_at", desc=True).limit(min(max(limit, 1), 100)))
    if status:
        q = q.eq("status", status)
    return {"entries": [entry_out(r) for r in q.execute().data]}


@router.post("/entries", status_code=201)
def create_entry(body: NewEntry, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    party_id = body.party_id
    kind = party_kind_for(body.type)
    if body.type in NO_PARTY_TYPES:
        party_id = None if not body.party_id else party_id
    elif not party_id:
        if not (body.party_name or "").strip():
            raise AppError(422, "party_required", "Enter a name for this entry.")
        party_id = get_or_create_party(db, m["shop_id"], body.party_name, kind, needs_review=False)
    row = db.table("entries").insert({
        "shop_id": m["shop_id"], "party_id": party_id, "type": body.type,
        "amount_paise": round(body.amount_rupees * 100), "note": body.note,
        "occurred_on": body.occurred_on or today_ist().isoformat(), "status": "confirmed",
        "source": "manual", "created_by": user.id, "confirmed_by": user.id, "confirmed_at": now_iso(),
    }).execute().data[0]
    return fetch_entry(db, row["id"])


@router.post("/entries/{entry_id}/confirm")
def confirm_entry(entry_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    entry = fetch_entry(db, entry_id)
    if entry["status"] != "pending":
        raise AppError(409, "not_pending", "Only pending entries can be confirmed.")
    db.table("entries").update({"status": "confirmed", "confirmed_by": user.id,
                                "confirmed_at": now_iso()}).eq("id", entry_id).execute()
    return fetch_entry(db, entry_id)


@router.post("/entries/{entry_id}/void")
def void_entry(entry_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    fetch_entry(db, entry_id)
    db.table("entries").update({"status": "voided"}).eq("id", entry_id).execute()
    return fetch_entry(db, entry_id)
