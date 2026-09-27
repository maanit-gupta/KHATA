"""GOAL_2.0 P4.1: fill shop_members.display_name from each user's sign-up name (auth metadata),
for members who joined before the column existed. Uses the admin API (auth metadata isn't
readable otherwise). Only fills empty names; never overwrites a name someone set.

Usage: backend/.venv/bin/python backend/scripts/backfill_display_names.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import admin_client  # noqa: E402


def main(dry_run: bool) -> None:
    admin = admin_client()
    empty = admin.table("shop_members").select("user_id, shop_id").is_("display_name", "null").execute().data
    filled = 0
    for row in empty:
        user = admin.auth.admin.get_user_by_id(row["user_id"]).user
        name = ((user.user_metadata or {}).get("name") or "").strip()[:60]
        if not name:
            continue
        if not dry_run:
            (admin.table("shop_members").update({"display_name": name}).eq("user_id", row["user_id"])
             .is_("display_name", "null").execute())
        filled += 1
    print(f"members without a name: {len(empty)}; filled from sign-up names: {filled}{' (dry run)' if dry_run else ''}")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)
