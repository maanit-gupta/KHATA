"""Shop members' names (GOAL_2.0 P4.1). `shop_members.display_name` is readable by every member
of the shop (RLS members_read), so the API can name who did what: the name, with "(you)" after
your own. Before a name is set (older rows, or the backfill not run yet) a member is "Member",
and you are your own sign-up name."""

from __future__ import annotations

from .auth import CurrentUser

FALLBACK = "Member"


def member_rows(db, shop_id: str) -> list[dict]:
    return (db.table("shop_members").select("user_id, display_name, role, joined_at").eq("shop_id", shop_id)
            .order("joined_at").execute().data)


def name_map(db, shop_id: str, me: CurrentUser) -> dict[str, str]:
    """user_id → how to show them: "Priya", or "Asha (you)"."""
    out = {}
    for r in member_rows(db, shop_id):
        name = (r.get("display_name") or "").strip() or (me.name if r["user_id"] == me.id else None) or FALLBACK
        out[r["user_id"]] = f"{name} (you)" if r["user_id"] == me.id else name
    return out


def who(names: dict[str, str], user_id: str | None) -> str | None:
    """A name for an actor id; ids no longer in the shop (or none) read as "Member"."""
    if not user_id:
        return None
    return names.get(user_id, FALLBACK)
