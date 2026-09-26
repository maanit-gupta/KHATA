from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict

from ..auth import CurrentUser, current_user
from ..db import PG_UNIQUE_VIOLATION, user_client
from ..errors import AppError
from ..ledger import (ENTRY_SELECT, PARTY_KINDS, check_uuid, entry_out, expected_party_kind, not_found,
                      require_membership)

router = APIRouter()


def _balance_row(db, party_id: str) -> dict:
    check_uuid(party_id, "party")
    rows = db.table("party_balances").select("*").eq("party_id", party_id).limit(1).execute().data
    if not rows:
        raise not_found("party")
    return rows[0]


@router.get("/parties")
def list_parties(kind: str | None = None, q: str | None = None, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    if kind is not None and kind not in PARTY_KINDS:
        raise AppError(422, "bad_kind", "Kind must be customer or supplier.")
    query = (user_client(user.token).table("party_balances").select("*")
             .eq("shop_id", m["shop_id"]).order("display_name"))
    if kind:
        query = query.eq("kind", kind)
    if q and q.strip():
        query = query.ilike("display_name", f"%{q.strip()}%")
    return {"parties": query.execute().data}


@router.get("/parties/{party_id}")
def get_party(party_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    party = _balance_row(db, party_id)
    entries = (db.table("entries").select(ENTRY_SELECT).eq("party_id", party_id)
               .in_("status", ["confirmed", "pending"]).order("occurred_on", desc=True)
               .order("created_at", desc=True).execute().data)
    return {"party": party, "balance_paise": party["balance_paise"],
            "entries": [entry_out(r) for r in entries]}


class PartyPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = None
    kind: Literal[PARTY_KINDS] | None = None  # type: ignore[valid-type]
    needs_review: bool | None = None


@router.patch("/parties/{party_id}")
def edit_party(party_id: str, body: PartyPatch, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    current = _balance_row(db, party_id)
    sent = body.model_dump(exclude_unset=True)
    changes: dict = {}
    if "display_name" in sent:
        name = (sent["display_name"] or "").strip()
        if not name:
            raise AppError(422, "name_required", "Enter a name.")
        changes.update(display_name=name, name_latin=name.lower())  # CLAUDE.md §6.5: rename → name_latin
    if sent.get("kind") and sent["kind"] != current["kind"]:
        types = {r["type"] for r in db.table("entries").select("type").eq("party_id", party_id).execute().data}
        if any(expected_party_kind(t) not in (None, sent["kind"]) for t in types):
            raise AppError(422, "kind_in_use",
                           f"{current['display_name']} already has {current['kind']} entries, so the kind can't change.")
        changes["kind"] = sent["kind"]
    if sent.get("needs_review") is not None:
        changes["needs_review"] = sent["needs_review"]
    if changes:
        try:
            db.table("parties").update(changes).eq("id", party_id).execute()
        except APIError as e:
            if e.code == PG_UNIQUE_VIOLATION:
                raise AppError(409, "name_taken",
                               "Someone with that name already exists. Merge the two instead.") from e
            raise
    return _balance_row(db, party_id)


class MergeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    into_party_id: str


@router.post("/parties/{party_id}/merge")
def merge_party(party_id: str, body: MergeBody, user: CurrentUser = Depends(current_user)):
    """Move every entry (any status) to the target, keep this name as the target's alias so future
    voice matches find it, then delete the now-empty party (CLAUDE.md §6.5). Entry moves are
    updates, so each is audit-logged. Not one transaction: if a step fails, re-running the merge
    finishes the job (every step is idempotent)."""
    require_membership(user)
    db = user_client(user.token)
    source = _balance_row(db, party_id)
    target = _balance_row(db, body.into_party_id)
    if source["party_id"] == target["party_id"]:
        raise AppError(422, "same_party", "Pick a different person to merge into.")
    if source["kind"] != target["kind"]:
        raise AppError(422, "kind_mismatch", "A customer can only be merged into a customer, and a supplier into a supplier.")

    names = {r["name_latin"] for r in db.table("parties").select("name_latin").eq("id", party_id).execute().data}
    names |= {r["alias_latin"] for r in
              db.table("party_aliases").select("alias_latin").eq("party_id", party_id).execute().data}
    if names:
        db.table("party_aliases").upsert([{"party_id": target["party_id"], "alias_latin": n} for n in names],
                                         on_conflict="party_id,alias_latin", ignore_duplicates=True).execute()
    db.table("entries").update({"party_id": target["party_id"]}).eq("party_id", party_id).execute()
    db.table("parties").delete().eq("id", party_id).execute()
    return _balance_row(db, target["party_id"])
