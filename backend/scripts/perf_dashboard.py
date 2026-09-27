"""GOAL_2.0 P6 AC: "the dashboard loads in under 1.5 s on the seeded shop (measured and logged)".

Seeds a throwaway shop on the live project with 90 days of a busy kirana's book, times GET /dashboard
through the app (JWT check + every SQL query), and writes artifacts/perf/dashboard.json. No Sarvam or
Groq calls. The browser half is frontend/scripts/perf_dashboard.mjs, run against the same shop.

  backend/.venv/bin/python backend/scripts/perf_dashboard.py seed <creds.json>     # seed, time the API, keep
  backend/.venv/bin/python backend/scripts/perf_dashboard.py time <creds.json>     # time the API again
  backend/.venv/bin/python backend/scripts/perf_dashboard.py cleanup <creds.json>  # delete the shop and user
"""

from __future__ import annotations

import json
import random
import statistics
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from supabase import ClientOptions, create_client  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import admin_client, user_client  # noqa: E402
from app.ledger import today_ist  # noqa: E402
from app.main import app  # noqa: E402

OUT = ROOT / "artifacts" / "perf" / "dashboard.json"
DAYS = 90
CUSTOMERS = ["Ramesh", "Kavya", "Arjun", "Meena", "Ravi", "Lakshmi", "Suresh", "Priya", "Imran", "Selvi", "Gurdeep",
             "Anita", "Farhan", "Kusum", "Pallavi", "Deepak", "Nisha", "Joseph", "Fatima", "Manoj", "Rekha", "Vinod",
             "Sunita", "Harish", "Geeta"]
SUPPLIERS = ["Lotus Agencies", "Balaji Stores", "Gupta Traders", "Kaveri Provisions", "Shree Balaji", "Metro Wholesale"]
CATEGORIES = ["stock_other", "rent", "electricity", "wages", "transport", "repairs", "misc", None]


def seed(creds_path: Path) -> None:
    email, password = f"khata-perf-{uuid.uuid4().hex[:10]}@example.com", uuid.uuid4().hex
    created = admin_client().auth.admin.create_user({"email": email, "password": password, "email_confirm": True,
                                                     "user_metadata": {"name": "Perf Owner"}})
    s = get_settings()
    anon = create_client(s.supabase_url, s.supabase_publishable_key, ClientOptions(auto_refresh_token=False, persist_session=False))
    token = anon.auth.sign_in_with_password({"email": email, "password": password}).session.access_token
    headers = {"Authorization": f"Bearer {token}"}
    client = TestClient(app)
    r = client.post("/shops", json={"name": "Perf Kirana", "lang": "hi-IN"}, headers=headers)
    assert r.status_code == 201, r.text
    shop_id = r.json()["shop"]["id"]
    creds_path.write_text(json.dumps({"shop_id": shop_id, "users": [{"id": created.user.id, "email": email, "password": password}]}))

    db = user_client(token)
    parties = db.table("parties").insert(
        [{"shop_id": shop_id, "kind": "customer", "display_name": n, "name_latin": n.lower()} for n in CUSTOMERS]
        + [{"shop_id": shop_id, "kind": "supplier", "display_name": n, "name_latin": n.lower()} for n in SUPPLIERS]).execute().data
    cust = [p["id"] for p in parties if p["kind"] == "customer"]
    supp = [p["id"] for p in parties if p["kind"] == "supplier"]
    rnd = random.Random(7)
    today = today_ist()
    rows = []
    for n in range(DAYS):
        day = (today - timedelta(days=n)).isoformat()
        for _ in range(rnd.randint(5, 11)):
            kind = rnd.choices(["cash_sale", "credit_given", "payment_received", "expense", "purchase_credit",
                                "purchase_paid", "payment_made"], [40, 22, 14, 10, 6, 4, 4])[0]
            row = {"shop_id": shop_id, "type": kind, "amount_paise": rnd.randint(20, 2500) * 100, "occurred_on": day,
                   "status": "confirmed", "source": rnd.choice(["voice", "manual", "receipt"]), "created_by": created.user.id,
                   "confirmed_by": created.user.id, "confirmed_at": f"{day}T12:00:00+05:30"}
            if kind in ("credit_given", "payment_received"):
                row["party_id"] = rnd.choice(cust)
            elif kind in ("purchase_credit", "payment_made"):
                row["party_id"] = rnd.choice(supp)
            elif kind == "expense":
                row["expense_category"] = rnd.choice(CATEGORIES)
            if rnd.random() < 0.03:
                row["status"] = "voided"
            rows.append(row)
    for i in range(0, len(rows), 200):
        db.table("entries").insert(rows[i:i + 200]).execute()
    time_api(creds_path)


def time_api(creds_path: Path) -> None:
    c = json.loads(creds_path.read_text())
    u = c["users"][0]
    s = get_settings()
    anon = create_client(s.supabase_url, s.supabase_publishable_key, ClientOptions(auto_refresh_token=False, persist_session=False))
    headers = {"Authorization": f"Bearer {anon.auth.sign_in_with_password({'email': u['email'], 'password': u['password']}).session.access_token}"}
    client = TestClient(app)
    n_entries = admin_client().table("entries").select("id", count="exact").eq("shop_id", c["shop_id"]).limit(1).execute().count
    client.get("/dashboard", headers=headers)                     # warm: JWKS, connections
    times = []
    for _ in range(7):
        t0 = time.perf_counter()
        r = client.get("/dashboard", headers=headers)
        times.append((time.perf_counter() - t0) * 1000)
        assert r.status_code == 200, r.text
    body = r.json()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    result = {"measured_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "entries": n_entries, "days": DAYS,
              "customers": len(CUSTOMERS), "suppliers": len(SUPPLIERS),
              "api_ms": {"runs": [round(t) for t in times], "median": round(statistics.median(times)), "max": round(max(times))},
              "aging_rows": len(body["aging"]["rows"]), "register_days": len(body["register"]["days"]),
              "note": "GET /dashboard through the FastAPI app (TestClient) from the dev machine to the live Supabase project."}
    if OUT.exists() and "browser_ms" in (prev := json.loads(OUT.read_text())):
        result["browser_ms"] = prev["browser_ms"]
    OUT.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


def cleanup(creds_path: Path) -> None:
    c = json.loads(creds_path.read_text())
    admin = admin_client()
    admin.table("audit_log").delete().eq("shop_id", c["shop_id"]).execute()
    admin.table("shops").delete().eq("id", c["shop_id"]).execute()
    for u in c["users"]:
        admin.auth.admin.delete_user(u["id"])
    print("deleted shop", c["shop_id"], "and", len(c["users"]), "user(s)")


if __name__ == "__main__":
    {"seed": seed, "time": time_api, "cleanup": cleanup}[sys.argv[1]](Path(sys.argv[2]))
