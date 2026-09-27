"""GOAL_2.0 P4: who is in the shop, and what they did.

GET /members: every member's name, role and joined date, plus the invite code (Settings, P4.6).
GET /activity: the last actions from audit_log as "who · what · when" (dashboard feed, P4.4).
Both read through the caller's user-scoped client, so RLS keeps them to the caller's shop."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..ledger import require_membership
from ..members import FALLBACK, member_rows, name_map, who

router = APIRouter()

ACTIVITY_LIMIT = 30


@router.get("/members")
def members(user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    names = name_map(db, m["shop_id"], user)
    shop = db.table("shops").select("invite_code").eq("id", m["shop_id"]).limit(1).execute().data
    return {"members": [{"user_id": r["user_id"], "name": names.get(r["user_id"], FALLBACK),
                         "display_name": r.get("display_name"), "role": r["role"], "joined_at": r["joined_at"],
                         "you": r["user_id"] == user.id} for r in member_rows(db, m["shop_id"])],
            "invite_code": shop[0]["invite_code"] if shop else None}


@router.get("/activity")
def activity(limit: int = ACTIVITY_LIMIT, user: CurrentUser = Depends(current_user)):
    """Newest first. Each row names the actor and the entry as it was after the action."""
    m = require_membership(user)
    db = user_client(user.token)
    rows = (db.table("audit_log").select("id, action, entry_id, before, after, actor, at").eq("shop_id", m["shop_id"])
            .order("at", desc=True).order("id", desc=True).limit(max(1, min(limit, ACTIVITY_LIMIT))).execute().data)
    names = name_map(db, m["shop_id"], user)
    party_ids = {r["after"]["party_id"] for r in rows if (r.get("after") or {}).get("party_id")}
    parties = {}
    if party_ids:
        parties = {p["id"]: p["display_name"] for p in
                   db.table("parties").select("id, display_name").in_("id", list(party_ids)).execute().data}
    out = []
    for r in rows:
        after, before = r.get("after") or {}, r.get("before") or {}
        changed = [f for f in ("amount_paise", "type", "party_id", "occurred_on", "note")
                   if r["action"] == "edit" and before.get(f) != after.get(f)]
        out.append({"id": r["id"], "at": r["at"], "action": r["action"], "entry_id": r["entry_id"],
                    "by": who(names, r.get("actor")) or FALLBACK, "by_you": r.get("actor") == user.id,
                    "type": after.get("type"), "amount_paise": after.get("amount_paise"),
                    "party_name": parties.get(after.get("party_id")), "note": after.get("note"),
                    "changed": changed})
    return {"activity": out}
