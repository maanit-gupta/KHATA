"""Seed a shop with 6 parties and ~15 mixed confirmed entries so the demo doesn't start empty.

Usage (from repo root, using the backend venv):
    backend/.venv/bin/python scripts/seed_demo.py you@example.com
Looks up that user's shop and inserts with the secret key. Safe to re-run: existing parties
(same kind + name) are reused; entries are added again.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.db import admin_client  # noqa: E402

PARTIES = [("Ramesh", "customer"), ("Lakshmi", "customer"), ("Suresh", "customer"),
           ("Priya", "customer"), ("Gupta Traders", "supplier"), ("Balaji Dairy", "supplier")]

# (party or None, type, rupees, days ago, note)
ENTRIES = [
    ("Ramesh", "credit_given", 450, 12, None), ("Ramesh", "payment_received", 200, 6, None),
    ("Ramesh", "credit_given", 300, 2, None), ("Lakshmi", "credit_given", 1200, 20, None),
    ("Lakshmi", "payment_received", 500, 9, None), ("Suresh", "credit_given", 780, 4, None),
    ("Priya", "credit_given", 150, 1, None), ("Priya", "payment_received", 150, 0, None),
    ("Gupta Traders", "purchase_credit", 4200, 10, "Rice and dal"),
    ("Gupta Traders", "payment_made", 2000, 3, None),
    ("Balaji Dairy", "purchase_credit", 1800, 5, "Milk, curd"),
    (None, "cash_sale", 2350, 1, None), (None, "cash_sale", 1980, 0, None),
    (None, "expense", 600, 3, "Electricity"), (None, "cash_sale", 2710, 8, None),
]


def main(email: str) -> None:
    db = admin_client()
    users = db.auth.admin.list_users(per_page=1000)
    user = next((u for u in users if (u.email or "").lower() == email.lower()), None)
    if not user:
        sys.exit(f"No user with email {email}")
    rows = db.table("shop_members").select("shop_id").eq("user_id", user.id).execute().data
    if not rows:
        sys.exit(f"{email} has no shop yet; finish onboarding first")
    shop_id = rows[0]["shop_id"]

    ids: dict[str, str] = {}
    for name, kind in PARTIES:
        latin = name.lower()
        found = (db.table("parties").select("id").eq("shop_id", shop_id).eq("kind", kind)
                 .eq("name_latin", latin).execute().data)
        ids[name] = found[0]["id"] if found else db.table("parties").insert(
            {"shop_id": shop_id, "kind": kind, "display_name": name, "name_latin": latin}
        ).execute().data[0]["id"]

    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    db.table("entries").insert([{
        "shop_id": shop_id, "party_id": ids[p] if p else None, "type": typ,
        "amount_paise": rupees * 100, "note": note,
        "occurred_on": (now - timedelta(days=ago)).date().isoformat(),
        "status": "confirmed", "source": "manual", "created_by": user.id,
        "confirmed_by": user.id, "confirmed_at": now.isoformat(),
    } for p, typ, rupees, ago, note in ENTRIES]).execute()
    print(f"Seeded shop {shop_id}: {len(PARTIES)} parties, {len(ENTRIES)} entries")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
