"""GOAL_2.0 P7: tip rules (fire / stay silent on fixtures), the number guard on LLM phrasing, the
ai_reports cache (hit, miss on changed facts, refresh once per 5 minutes), report language, the daily
briefing (text and audio caches), the report data, and the two new Q&A tools. Sarvam and Groq are
fakes; the database is live (throwaway users)."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from app import tips
from app.db import user_client
from app.ledger import now_ist, today_ist
from app.qa_tools import make_tools
from app.routers import reports

T = today_ist()


def day(n: int) -> str:
    return (T - timedelta(days=n)).isoformat()


def add(client, u, **body):
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


# --- P7.1 tip rules on fixtures -------------------------------------------------------------
BASE = {"aging": [], "collections": {"this_week_paise": 0, "last_week_paise": 0, "drop_paise": 0},
        "expense_excess": [], "credit_excess": [], "dues": [], "week_days": [], "pending_review": 0, "pending_paise": 0}


def facts(**over):
    return {**BASE, **over}


def rules_fired(f):
    return [t.rule for t in tips.fired(f)]


@pytest.mark.parametrize("f, fires", [
    (facts(aging=[{"name": "Arjun", "balance_paise": 50_001, "age_days": 30, "last_payment_on": None}]), True),
    (facts(aging=[{"name": "Arjun", "balance_paise": 50_001, "age_days": 29, "last_payment_on": None}]), False),
    (facts(aging=[{"name": "Arjun", "balance_paise": 50_000, "age_days": 90, "last_payment_on": None}]), False),
])
def test_overdue_customer(f, fires):
    assert rules_fired(f) == (["overdue_customer"] if fires else [])


@pytest.mark.parametrize("this, last, fires", [(7_499, 10_000, True), (7_500, 10_000, False), (0, 0, False), (500, 0, False)])
def test_collections_down(this, last, fires):
    f = facts(collections={"this_week_paise": this, "last_week_paise": last, "drop_paise": last - this})
    assert rules_fired(f) == (["collections_down"] if fires else [])


@pytest.mark.parametrize("this, avg, fires", [(14_001, 10_000, True), (14_000, 10_000, False), (9_000, 0, False)])
def test_expense_up(this, avg, fires):
    f = facts(expense_excess=[{"category": "transport", "this_week_paise": this, "prev4_avg_paise": avg, "excess_paise": this - avg}])
    assert rules_fired(f) == (["expense_up"] if fires else [])


@pytest.mark.parametrize("this, usual, fires", [(20_001, 10_000, True), (20_000, 10_000, False), (50_000, 0, False)])
def test_credit_up(this, usual, fires):
    f = facts(credit_excess=[{"display_name": "Meena", "this_month_paise": this, "usual_paise": usual, "excess_paise": this - usual}])
    assert rules_fired(f) == (["credit_up"] if fires else [])


@pytest.mark.parametrize("days, fires", [(30, True), (29, False)])
def test_supplier_unchanged(days, fires):
    f = facts(dues=[{"name": "Lotus Agencies", "owed_paise": 60_000, "days_since_last_activity": days}])
    assert rules_fired(f) == (["supplier_unchanged"] if fires else [])


def test_cash_negative_names_the_worst_day():
    f = facts(week_days=[{"day": "2026-09-21", "net_cash_paise": 500}, {"day": "2026-09-22", "net_cash_paise": -100},
                         {"day": "2026-09-23", "net_cash_paise": -3_000}])
    [t] = tips.fired(f)
    assert (t.rule, t.impact_paise, t.facts["day"], t.facts["days_negative"]) == ("cash_negative", 3_000, "2026-09-23", 2)
    assert "Wednesday" in t.text_en and "30 rupees short" in t.text_en
    assert rules_fired(facts(week_days=[{"day": "2026-09-21", "net_cash_paise": 0}])) == []


@pytest.mark.parametrize("n, fires", [(6, True), (5, False)])
def test_review_backlog(n, fires):
    assert rules_fired(facts(pending_review=n, pending_paise=1_000)) == (["review_backlog"] if fires else [])


def test_top_three_by_rupee_impact():
    f = facts(aging=[{"name": "Arjun", "balance_paise": 80_000, "age_days": 70, "last_payment_on": None}],
              dues=[{"name": "Lotus", "owed_paise": 60_000, "days_since_last_activity": 40}],
              week_days=[{"day": "2026-09-22", "net_cash_paise": -100_000}],
              pending_review=9, pending_paise=5_000,
              credit_excess=[{"display_name": "Meena", "this_month_paise": 30_000, "usual_paise": 10_000, "excess_paise": 20_000}])
    assert [t.rule for t in tips.top(f)] == ["cash_negative", "overdue_customer", "supplier_unchanged"]
    assert len(tips.fired(f)) == 5


# --- P7.2 summaries ----------------------------------------------------------------------------
def get_summary(client, u, period="day"):
    r = client.get(f"/reports/summary?period={period}", headers=u["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_shop_needs_no_llm(client, users, fake_groq):
    u = users.with_shop()
    body = get_summary(client, u)
    assert body["summary"] == "No entries yet today." and body["tips"] == [] and fake_groq.calls == []


def test_llm_phrasing_is_kept_when_every_number_is_a_fact(client, users, fake_groq):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300)
    fake_groq.script(fake_groq.text(json.dumps({"summary": "Today so far you sold 300 rupees in cash.", "tips": []})))
    body = get_summary(client, u)
    assert body["summary"] == "Today so far you sold 300 rupees in cash."
    call = fake_groq.calls[0]
    assert call["response_format"]["json_schema"]["name"] == "shop_report" and call["model"] == "openai/gpt-oss-20b"
    sent = json.loads(call["messages"][1]["content"])
    assert sent["current"]["cash_sales_rupees"] == 300 and sent["so_far"] is True     # rupees, not paise


def test_a_fabricated_number_is_rejected_and_the_template_used(client, users, fake_groq):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300)
    add(client, u, type="credit_given", amount_rupees=800, party_name="Arjun", occurred_on=day(40))   # overdue tip
    fake_groq.script(fake_groq.text(json.dumps({
        "summary": "Sales are up 25 percent to 375 rupees.",                           # invented numbers
        "tips": ["Arjun owes 1000 rupees; call him today."]})))                         # invented amount
    body = get_summary(client, u)
    assert body["summary"] == ("Today so far: 300 rupees in cash sales, 0 rupees given on credit, "
                               "0 rupees collected and 0 rupees spent.")
    assert body["tips"] == ["Arjun owes 800 rupees, 40 days since they first took credit. Ask for a payment."]
    assert body["tip_facts"] == [{"rule": "overdue_customer", "name": "Arjun", "balance_paise": 80000, "days": 40}]


def test_cache_hit_miss_and_refresh_once_per_5_minutes(client, users, fake_groq, monkeypatch):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300)
    fake_groq.handler = lambda kw: fake_groq.text(json.dumps({"summary": "So far 300 rupees in cash sales.", "tips": []}))
    first = get_summary(client, u)
    assert first["cached"] is False and len(fake_groq.calls) == 1
    again = get_summary(client, u)
    assert again["cached"] is True and len(fake_groq.calls) == 1 and again["summary"] == first["summary"]
    add(client, u, type="cash_sale", amount_rupees=50)                                   # the facts change
    fake_groq.handler = lambda kw: fake_groq.text(json.dumps({"summary": "So far 350 rupees in cash sales.", "tips": []}))
    changed = get_summary(client, u)
    assert changed["cached"] is False and changed["summary"] == "So far 350 rupees in cash sales." and len(fake_groq.calls) == 2

    r = client.post("/reports/summary/refresh", json={"period": "day"}, headers=u["headers"])
    assert r.status_code == 429 and r.json()["error"]["code"] == "refresh_too_soon"
    assert len(fake_groq.calls) == 2
    later = now_ist() + timedelta(minutes=6)
    monkeypatch.setattr(reports, "now_ist", lambda: later)
    r = client.post("/reports/summary/refresh", json={"period": "day"}, headers=u["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["cached"] is False and len(fake_groq.calls) == 3


def test_summary_is_written_in_the_report_language_and_cached_per_language(client, users, fake_groq, fake_sarvam):
    u = users.with_shop(lang="hi-IN")
    client.patch("/me", json={"report_lang": "ta-IN", "voice_lang": "kn-IN"}, headers=u["headers"])
    add(client, u, type="cash_sale", amount_rupees=300)
    add(client, u, type="credit_given", amount_rupees=800, party_name="Arjun", occurred_on=day(40))
    fake_groq.handler = lambda kw: fake_groq.text(json.dumps({"summary": "So far 300 rupees in cash sales.",
                                                               "tips": ["Arjun owes 800 rupees; ask for it."]}))
    body = get_summary(client, u)
    assert body["lang"] == "ta-IN"
    assert body["summary"] == "[ta-IN] So far 300 rupees in cash sales." and body["tips"] == ["[ta-IN] Arjun owes 800 rupees; ask for it."]
    assert body["summary_en"] == "So far 300 rupees in cash sales."
    assert {c[3] for c in fake_sarvam.calls if c[0] == "translate"} == {"ta-IN"}        # not the voice language
    n = fake_sarvam.count("translate")
    assert get_summary(client, u)["summary"].startswith("[ta-IN]") and fake_sarvam.count("translate") == n
    rows = user_client(u["token"]).table("ai_reports").select("lang, facts_hash").eq("shop_id", u["shop_id"]).execute().data
    assert sorted(r["lang"] for r in rows) == ["en-IN", "ta-IN"] and len({r["facts_hash"] for r in rows}) == 1


def test_week_and_month_periods(client, users, fake_groq):
    u = users.with_shop()
    fake_groq.handler = lambda kw: fake_groq.text(json.dumps({"summary": "Quiet so far.", "tips": []}))
    add(client, u, type="cash_sale", amount_rupees=10)
    week = get_summary(client, u, "week")
    assert week["from"] == (T - timedelta(days=T.weekday())).isoformat() and week["period_start"] == week["from"]
    month = get_summary(client, u, "month")
    assert month["from"] == T.replace(day=1).isoformat()
    sent = json.loads(fake_groq.calls[-1]["messages"][1]["content"])
    assert sent["compared_with"] == "the same days last month" and sent["current"]["cash_sales_rupees"] == 10
    assert client.get("/reports/summary?period=year", headers=u["headers"]).status_code == 422
    assert client.get(f"/reports/summary?date={(T + timedelta(days=1)).isoformat()}", headers=u["headers"]).status_code == 422


# --- P7.3 report data --------------------------------------------------------------------------
def test_report_data_for_a_range(client, users):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300, occurred_on=day(2))
    add(client, u, type="expense", amount_rupees=70, expense_category="transport", occurred_on=day(1))
    add(client, u, type="cash_sale", amount_rupees=999, occurred_on=day(9))                    # outside
    r = client.get(f"/reports/data?from={day(6)}&to={T.isoformat()}", headers=u["headers"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert (d["from"], d["to"], len(d["register"]["days"])) == (day(6), T.isoformat(), 7)
    assert (d["totals"]["cash_sales_paise"], d["totals"]["expenses_paise"], d["totals"]["net_cash_paise"]) == (30000, 7000, 23000)
    assert d["expenses"] == [{"category": "transport", "total_paise": 7000, "entry_count": 1}]
    assert client.get(f"/reports/data?from={T.isoformat()}&to={day(1)}", headers=u["headers"]).status_code == 422
    assert client.get(f"/reports/data?from={day(100)}&to={T.isoformat()}", headers=u["headers"]).json()["error"]["code"] == "range_too_long"


# --- P7.4 daily briefing -------------------------------------------------------------------------
def test_briefing_text_and_audio_are_cached(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="hi-IN")
    add(client, u, type="cash_sale", amount_rupees=300, occurred_on=day(1))
    add(client, u, type="payment_received", amount_rupees=150, party_name="Ravi", occurred_on=day(1))
    add(client, u, type="credit_given", amount_rupees=800, party_name="Arjun", occurred_on=day(40))
    b = client.get("/briefing", headers=u["headers"]).json()
    assert b["text_en"] == ("Yesterday: 300 rupees in cash sales, 0 rupees given on credit, 150 rupees collected and "
                            "0 rupees spent. Arjun owes 800 rupees, 40 days since they first took credit. Ask for a payment. "
                            "Nothing is waiting in Review.")
    assert b["text"] == "[hi-IN] " + b["text_en"] and len(b["text"]) <= 700
    assert (b["lang"], b["voice"], b["audio_cached"]) == ("hi-IN", "shubh", False)
    assert fake_groq.calls == []                                   # the briefing is a template: no LLM
    n = fake_sarvam.count("translate")
    assert client.get("/briefing", headers=u["headers"]).json()["text"] == b["text"] and fake_sarvam.count("translate") == n

    first = client.post("/briefing/audio", headers=u["headers"]).json()
    assert first["cached"] is False and first["url"].startswith("http")
    assert [c[1:] for c in fake_sarvam.calls if c[0] == "tts"] == [(b["text"], "hi-IN", "shubh")]
    again = client.post("/briefing/audio", headers=u["headers"]).json()
    assert again["cached"] is True and fake_sarvam.count("tts") == 1              # a replay costs nothing
    assert client.get("/briefing", headers=u["headers"]).json()["audio_cached"] is True


def test_briefing_follows_the_report_language_and_its_voice(client, users, fake_sarvam):
    u = users.with_shop(lang="hi-IN")
    client.patch("/me", json={"report_lang": "ta-IN"}, headers=u["headers"])
    b = client.get("/briefing", headers=u["headers"]).json()
    assert b["text_en"] == "Yesterday there were no entries. Nothing is waiting in Review."
    assert (b["lang"], b["voice"]) == ("ta-IN", "ratan") and b["text"].startswith("[ta-IN]")
    client.post("/briefing/audio", headers=u["headers"])
    assert [c[2:] for c in fake_sarvam.calls if c[0] == "tts"] == [("ta-IN", "ratan")]


def test_briefing_script_stays_under_700_characters():
    long_name = "N" * 600
    f = {"yesterday": {"entry_count": 1, "cash_sales_paise": 100, "credit_given_paise": 0, "collected_paise": 0, "expenses_paise": 0},
         **BASE, "aging": [{"name": long_name, "balance_paise": 90_000, "age_days": 45, "last_payment_on": None}], "pending_review": 2}
    text = reports.briefing_script(f)
    assert len(text) <= 700 and text.endswith("2 items are waiting in Review.") and long_name not in text


# --- P7.5 Q&A tools ------------------------------------------------------------------------------
def test_daily_register_and_credit_aging_tools(client, users):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300, occurred_on=day(1))
    add(client, u, type="credit_given", amount_rupees=800, party_name="Arjun", occurred_on=day(40))
    add(client, u, type="credit_given", amount_rupees=200, party_name="Meena", occurred_on=day(3))
    tools = make_tools(user_client(u["token"]), T)
    reg = tools["get_daily_register"](u["shop_id"], from_date=day(6), to_date=T.isoformat())
    assert reg == {"days": [   # quiet days left out; Arjun's credit is before the range
        {"date": day(3), "cash_sales_rupees": 0, "credit_given_rupees": 200, "collected_rupees": 0,
         "expenses_rupees": 0, "net_cash_in_hand_rupees": 0, "entries": 1},
        {"date": day(1), "cash_sales_rupees": 300, "credit_given_rupees": 0, "collected_rupees": 0,
         "expenses_rupees": 0, "net_cash_in_hand_rupees": 300, "entries": 1}]}
    assert "error" in tools["get_daily_register"](u["shop_id"], from_date=day(90), to_date=T.isoformat())
    aging = tools["get_credit_aging"](u["shop_id"])
    assert [(c["name"], c["owes_rupees"], c["days"], c["age_bucket_days"]) for c in aging["customers"]] == [
        ("Arjun", 800, 40, "31-60"), ("Meena", 200, 3, "0-7")]
    from app.services.llm_router import QA_TOOLS
    names = {t["function"]["name"] for t in QA_TOOLS}
    assert {"get_daily_register", "get_credit_aging"} <= names and set(tools) == names
