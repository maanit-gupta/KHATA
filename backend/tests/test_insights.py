"""P6: GET /insights/weekly against hand-computed fixtures. "Today" is Thursday 1 Oct 2026 (IST),
so this week (Mon 28 Sep – Sun 4 Oct) spans a month boundary."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app import ledger
from app.db import user_client
from app.routers.insights import week_start_for

IST = ZoneInfo("Asia/Kolkata")
TODAY = datetime(2026, 10, 1, 18, 30, tzinfo=IST)


@pytest.fixture
def clock(monkeypatch):
    state = {"now": TODAY}
    monkeypatch.setattr(ledger, "now_ist", lambda: state["now"])
    return state


def _add(client, u, t, rupees, day, name=None):
    body = {"type": t, "amount_rupees": rupees, "occurred_on": day}
    if name:
        body["party_name"] = name
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def shop(client, users, clock):
    u = users.with_shop(lang="ta-IN")
    # This week, so far (Mon 28 Sep → Thu 1 Oct)
    _add(client, u, "cash_sale", 1000, "2026-09-28")
    _add(client, u, "cash_sale", 250.50, "2026-10-01")
    _add(client, u, "credit_given", 500, "2026-09-29", "Ramesh")
    _add(client, u, "payment_received", 200, "2026-10-01", "Ramesh")
    _add(client, u, "expense", 300, "2026-09-30")
    _add(client, u, "cash_sale", 999, "2026-10-02")                      # after today: not "so far"
    v = _add(client, u, "cash_sale", 5000, "2026-09-29")
    client.post(f"/entries/{v['id']}/void", headers=u["headers"])         # voided: excluded
    user_client(u["token"]).table("entries").insert({                    # pending: excluded
        "shop_id": u["shop_id"], "type": "cash_sale", "amount_paise": 700000, "status": "pending",
        "source": "manual", "occurred_on": "2026-09-30"}).execute()
    # Last week (Mon 21 Sep → Sun 27 Sep)
    _add(client, u, "cash_sale", 800, "2026-09-21")
    _add(client, u, "cash_sale", 700, "2026-09-27")
    _add(client, u, "credit_given", 1000, "2026-09-25", "Lakshmi")
    _add(client, u, "expense", 100, "2026-09-27")
    _add(client, u, "cash_sale", 5000, "2026-09-20")                      # two weeks ago: excluded
    return u


EXPECTED_THIS = {"cash_sales_paise": 125050, "credit_given_paise": 50000, "collected_paise": 20000,
                 "expenses_paise": 30000, "purchases_paise": 0, "supplier_paid_paise": 0, "entry_count": 5}
EXPECTED_LAST = {"cash_sales_paise": 150000, "credit_given_paise": 100000, "collected_paise": 0,
                 "expenses_paise": 10000, "purchases_paise": 0, "supplier_paid_paise": 0, "entry_count": 4}


def test_week_boundaries():
    assert week_start_for(TODAY.date()).isoformat() == "2026-09-28"
    assert week_start_for(datetime(2026, 9, 27).date()).isoformat() == "2026-09-21"   # Sunday
    assert week_start_for(datetime(2026, 9, 28).date()).isoformat() == "2026-09-28"   # Monday


def test_metrics_match_hand_computed_values(client, shop, fake_sarvam, fake_groq):
    fake_groq.script(fake_groq.text("So far this week you sold 1250.5 rupees in cash. "
                                    "Lakshmi owes 1000 rupees. Ask Lakshmi to pay."))
    r = client.get("/insights/weekly", headers=shop["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["week_start"], body["week_end"], body["today"]) == ("2026-09-28", "2026-10-04", "2026-10-01")
    assert body["this_week"] == EXPECTED_THIS
    assert body["last_week"] == EXPECTED_LAST
    assert [(d["name"], d["balance_paise"], d["days_since_last_activity"]) for d in body["top_debtors"]] == \
        [("Lakshmi", 100000, 6), ("Ramesh", 30000, 0)]
    # Groq saw rupees, not paise (§9b).
    sent = json.loads(fake_groq.calls[0]["messages"][1]["content"])
    assert sent["this_week_so_far"] == {"cash_sales_rupees": 1250.5, "credit_given_rupees": 500,
                                        "collected_rupees": 200, "expenses_rupees": 300}
    assert sent["top_debtors"][0] == {"name": "Lakshmi", "owes_rupees": 1000, "days_since_last_activity": 6}
    assert fake_groq.calls[0]["model"] == "openai/gpt-oss-20b"
    # Localized for the caller, number-guarded.
    assert body["narration_en"].startswith("So far this week you sold 1250.5 rupees")
    assert body["narration"] == "[ta-IN] " + body["narration_en"]


def test_narration_with_an_invented_number_uses_the_template(client, shop, fake_groq):
    fake_groq.script(fake_groq.text("Sales are up 20 percent to 1300 rupees."))
    body = client.get("/insights/weekly", headers=shop["headers"]).json()
    assert body["narration_en"] == ("This week so far: 1,250.50 rupees in cash sales, 500 rupees given on credit "
                                    "and 200 rupees collected. Lakshmi owes the most, 1,000 rupees.")


def test_cache_is_reused_for_15_minutes_then_recomputed(client, shop, clock, fake_sarvam, fake_groq):
    fake_groq.script(fake_groq.text("So far 1250.5 rupees in cash."), fake_groq.text("So far 1250.5 rupees in cash."),
                     fake_groq.text("So far 1250.5 rupees in cash."))
    client.get("/insights/weekly", headers=shop["headers"])
    assert len(fake_groq.calls) == 1 and fake_sarvam.count("translate") == 1
    clock["now"] = TODAY + timedelta(minutes=14)
    client.get("/insights/weekly", headers=shop["headers"])
    assert len(fake_groq.calls) == 1 and fake_sarvam.count("translate") == 1     # all from cache
    # Another language: translated once more, no new narration.
    client.patch("/me", json={"lang": "hi-IN"}, headers=shop["headers"])
    body = client.get("/insights/weekly", headers=shop["headers"]).json()
    assert body["narration"].startswith("[hi-IN] ") and len(fake_groq.calls) == 1
    # A new entry shows up once the cache is 15+ minutes old.
    _add(client, shop, "cash_sale", 100, "2026-10-01")
    clock["now"] = TODAY + timedelta(minutes=16)
    body = client.get("/insights/weekly", headers=shop["headers"]).json()
    assert len(fake_groq.calls) == 2 and body["this_week"]["cash_sales_paise"] == 135050
    row = user_client(shop["token"]).table("weekly_insights").select("*").execute().data
    assert len(row) == 1 and row[0]["week_start"] == "2026-09-28"


def test_empty_week(client, users, clock, fake_groq, fake_sarvam):
    u = users.with_shop(lang="en-IN")
    body = client.get("/insights/weekly", headers=u["headers"]).json()
    zero = {k: 0 for k in EXPECTED_THIS}
    assert body["this_week"] == zero and body["last_week"] == zero and body["top_debtors"] == []
    assert body["narration"] == "No entries yet this week." and fake_groq.calls == []
    assert fake_sarvam.count("translate") == 0                                   # en-IN


def test_groq_down_still_answers_with_the_template(client, shop, fake_groq):
    from app.errors import AppError

    def handler(kwargs):
        raise AppError(503, "service_busy", "Service busy, try again.")
    fake_groq.handler = handler
    body = client.get("/insights/weekly", headers=shop["headers"]).json()
    assert body["narration_en"].startswith("This week so far: 1,250.50 rupees in cash sales")
