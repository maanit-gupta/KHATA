from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..ledger import ENTRY_SELECT, entry_out, not_found, require_membership

router = APIRouter()


@router.get("/parties")
def list_parties(kind: str | None = None, q: str | None = None, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    query = (user_client(user.token).table("party_balances").select("*")
             .eq("shop_id", m["shop_id"]).order("display_name"))
    if kind:
        query = query.eq("kind", kind)
    if q:
        query = query.ilike("display_name", f"%{q}%")
    return {"parties": query.execute().data}


@router.get("/parties/{party_id}")
def get_party(party_id: str, user: CurrentUser = Depends(current_user)):
    require_membership(user)
    db = user_client(user.token)
    rows = db.table("party_balances").select("*").eq("party_id", party_id).limit(1).execute().data
    if not rows:
        raise not_found("party")
    entries = (db.table("entries").select(ENTRY_SELECT).eq("party_id", party_id)
               .in_("status", ["confirmed", "pending"]).order("occurred_on", desc=True)
               .order("created_at", desc=True).execute().data)
    return {"party": rows[0], "balance_paise": rows[0]["balance_paise"],
            "entries": [entry_out(r) for r in entries]}
