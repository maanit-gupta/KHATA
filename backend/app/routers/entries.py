from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..errors import AppError
from ..ledger import (ENTRY_SELECT, ENTRY_STATUSES, ENTRY_TYPES, NO_PARTY_TYPES, check_party, check_uuid,
                      entry_out, expected_party_kind, not_found, now_iso, parse_iso_date, party_kind_for,
                      require_membership, rupees_to_paise, today_ist)

router = APIRouter()

# Fields an edit may change (CLAUDE.md §4). Status changes go through /confirm and /void.
EDITABLE = ("type", "amount_paise", "party_id", "occurred_on", "note")


class NewEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[ENTRY_TYPES]  # type: ignore[valid-type]
    amount_rupees: float
    party_id: str | None = None
    party_name: str | None = None
    note: str | None = None
    occurred_on: str | None = None


class EntryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal[ENTRY_TYPES] | None = None  # type: ignore[valid-type]
    amount_rupees: float | None = None
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
    check_uuid(entry_id)
    rows = db.table("entries").select(ENTRY_SELECT).eq("id", entry_id).limit(1).execute().data
    if not rows:
        raise not_found()
    return entry_out(rows[0])


def resolve_party(db, shop_id: str, entry_type: str, party_id: str | None, party_name: str | None) -> str | None:
    """Pick the party for a manual create/edit: an id (checked for shop and kind) or a typed name."""
    name = (party_name or "").strip()
    if party_id:
        check_party(db, party_id, entry_type)
        return party_id
    if entry_type == "expense":
        return None
    kind = expected_party_kind(entry_type)
    if name and kind:
        return get_or_create_party(db, shop_id, name, kind, needs_review=False)
    if entry_type not in NO_PARTY_TYPES:
        raise AppError(422, "party_required", f"Enter the {party_kind_for(entry_type)}'s name for this entry.")
    return None


@router.get("/entries")
def list_entries(limit: int = 20, status: str | None = None, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    if status is not None and status not in ENTRY_STATUSES:
        raise AppError(422, "bad_status", "Status must be pending, confirmed or voided.")
    q = (user_client(user.token).table("entries").select(ENTRY_SELECT).eq("shop_id", m["shop_id"])
         .order("created_at", desc=True).limit(min(max(limit, 1), 100)))
    if status:
        q = q.eq("status", status)
    return {"entries": [entry_out(r) for r in q.execute().data]}


@router.post("/entries", status_code=201)
def create_entry(body: NewEntry, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    amount_paise = rupees_to_paise(body.amount_rupees)
    occurred_on = parse_iso_date(body.occurred_on, "entry date") or today_ist().isoformat()
    party_id = resolve_party(db, m["shop_id"], body.type, body.party_id, body.party_name)
    row = db.table("entries").insert({
        "shop_id": m["shop_id"], "party_id": party_id, "type": body.type,
        "amount_paise": amount_paise, "note": (body.note or "").strip() or None,
        "occurred_on": occurred_on, "status": "confirmed",
        "source": "manual", "created_by": user.id, "confirmed_by": user.id, "confirmed_at": now_iso(),
    }).execute().data[0]
    return fetch_entry(db, row["id"])


def _history(db, entry_id: str, user_id: str) -> list[dict]:
    """audit_log rows as "who, when, what changed (old → new)" (DESIGN.md §6.11). Another member's
    name isn't readable by a normal user (CLAUDE.md §3), so the actor is "you" or "another_member"."""
    rows = (db.table("audit_log").select("action, before, after, actor, at").eq("entry_id", entry_id)
            .order("at").order("id").execute().data)
    party_ids = {r[side]["party_id"] for r in rows for side in ("before", "after")
                 if r.get(side) and r[side].get("party_id")}
    names = {}
    if party_ids:
        names = {p["id"]: p["display_name"] for p in
                 db.table("parties").select("id, display_name").in_("id", list(party_ids)).execute().data}
    out = []
    for r in rows:
        before, after = r.get("before") or {}, r.get("after") or {}
        changes = []
        for f in (*EDITABLE, "status"):
            old, new = before.get(f), after.get(f)
            if r["action"] != "create" and old == new:
                continue
            if r["action"] == "create" and new is None:
                continue
            if f == "party_id":
                changes.append({"field": "party", "old": names.get(old, old), "new": names.get(new, new)})
            else:
                changes.append({"field": f, "old": old if r["action"] != "create" else None, "new": new})
        out.append({"action": r["action"], "at": r["at"],
                    "by": "you" if r.get("actor") == user_id else "another_member", "changes": changes})
    return out


@router.get("/entries/{entry_id}")
def get_entry(entry_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    entry = fetch_entry(db, entry_id)
    return {"entry": entry, "history": _history(db, entry_id, user.id)}


@router.patch("/entries/{entry_id}")
def edit_entry(entry_id: str, body: EntryPatch, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    current = fetch_entry(db, entry_id)
    if current["status"] == "voided":
        raise AppError(409, "voided", "Voided entries can't be changed.")
    sent = body.model_dump(exclude_unset=True)
    new_type = sent.get("type") or current["type"]
    changes: dict = {}
    if "amount_rupees" in sent:
        if sent["amount_rupees"] is None:
            raise AppError(422, "bad_amount", "The amount must be more than zero.")
        changes["amount_paise"] = rupees_to_paise(sent["amount_rupees"])
    if "occurred_on" in sent:
        changes["occurred_on"] = parse_iso_date(sent["occurred_on"], "entry date") or current["occurred_on"]
    if "note" in sent:
        changes["note"] = (sent["note"] or "").strip() or None
    if "type" in sent and sent["type"]:
        changes["type"] = sent["type"]

    party_sent = "party_id" in sent or "party_name" in sent
    if party_sent:
        changes["party_id"] = resolve_party(db, m["shop_id"], new_type, sent.get("party_id"), sent.get("party_name"))
    elif "type" in changes:
        # Type changed but the party didn't: keep it only if it still fits the new type.
        keep = current["party_id"]
        if new_type == "expense" or (keep and current.get("party_kind") != expected_party_kind(new_type)):
            keep = None
        if keep is None and new_type not in NO_PARTY_TYPES:
            raise AppError(422, "party_required",
                           f"Pick the {party_kind_for(new_type)} for this entry.")
        changes["party_id"] = keep

    changes = {k: v for k, v in changes.items() if v != current.get(k)}
    if changes:
        db.table("entries").update(changes).eq("id", entry_id).execute()
    return fetch_entry(db, entry_id)


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
    entry = fetch_entry(db, entry_id)
    if entry["status"] != "voided":
        db.table("entries").update({"status": "voided"}).eq("id", entry_id).execute()
    return fetch_entry(db, entry_id)
