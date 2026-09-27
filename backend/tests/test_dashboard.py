"""GOAL_2.0 P6: the dashboard's numbers, against hand-computed fixtures on live Supabase (throwaway
users). An empty shop, voided and pending entries excluded, aging bucket edges, supplier dues, a
month boundary, and expense categories (P6.6). T = today in IST."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.db import user_client
from app.ledger import today_ist
from tests.conftest import post_audio

T = today_ist()


def day(n: int) -> str:
    return (T - timedelta(days=n)).isoformat()


def add(client, u, **body):
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


def void(client, u, entry):
    assert client.post(f"/entries/{entry['id']}/void", headers=u["headers"]).status_code == 200


def pending(u, **row):
    return user_client(u["token"]).table("entries").insert({
        "shop_id": u["shop_id"], "status": "pending", "source": "manual", "created_by": u["id"], **row}).execute().data[0]


def dash(client, u):
    r = client.get("/dashboard", headers=u["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def test_empty_shop(client, users):
    u = users.with_shop()
    d = dash(client, u)
    assert d["today"] == T.isoformat()
    assert [(s["metric"], s["today_paise"], s["last_week_paise"], s["change_paise"]) for s in d["strip"]] == [
        ("cash_sales", 0, 0, 0), ("credit_given", 0, 0, 0), ("collected", 0, 0, 0), ("expenses", 0, 0, 0)]
    days = d["register"]["days"]
    assert len(days) == 30 and days[0]["day"] == day(29) and days[-1]["day"] == T.isoformat()
    assert all(x[k] == 0 for x in days for k in x if k.endswith("_paise") or k == "entry_count")
    assert sum(w["last_day"] >= w["first_day"] for w in d["register"]["weeks"]) == len(d["register"]["weeks"])
    assert d["aging"]["rows"] == [] and d["dues"]["rows"] == []
    assert d["aging"]["buckets"] == [{"bucket": b, "parties": 0, "total_paise": 0} for b in ("0-7", "8-30", "31-60", "60+")]
    assert d["expenses"]["rows"] == [] and d["top_customers"]["by_credit"] == [] and d["top_customers"]["by_collections"] == []


def test_register_today_strip_and_outstanding_credit(client, users):
    u = users.with_shop()
    add(client, u, type="cash_sale", amount_rupees=300)
    void(client, u, add(client, u, type="cash_sale", amount_rupees=50))                  # voided: never counts
    add(client, u, type="cash_sale", amount_rupees=200, occurred_on=day(7))
    add(client, u, type="expense", amount_rupees=70, expense_category="transport")
    add(client, u, type="expense", amount_rupees=40)
    add(client, u, type="purchase_paid", amount_rupees=300, occurred_on=day(1))
    add(client, u, type="payment_made", amount_rupees=100, party_name="Balaji Stores", occurred_on=day(2))
    add(client, u, type="credit_given", amount_rupees=200, party_name="Meena", occurred_on=day(3))
    add(client, u, type="payment_received", amount_rupees=150, party_name="Ravi", occurred_on=day(5))
    add(client, u, type="purchase_credit", amount_rupees=250, party_name="Balaji Stores", occurred_on=day(6))
    add(client, u, type="credit_given", amount_rupees=150, party_name="Ravi", occurred_on=day(20))
    add(client, u, type="credit_given", amount_rupees=800, party_name="Arjun", occurred_on=day(70))  # before the window
    pending(u, type="cash_sale", amount_paise=600000)                                     # pending: never counts
    d = dash(client, u)

    assert [(s["metric"], s["today_paise"], s["last_week_paise"], s["change_paise"]) for s in d["strip"]] == [
        ("cash_sales", 30000, 20000, 10000), ("credit_given", 0, 0, 0), ("collected", 0, 0, 0),
        ("expenses", 11000, 0, 11000)]

    by_day = {x["day"]: x for x in d["register"]["days"]}
    cols = ("cash_sales_paise", "credit_given_paise", "collected_paise", "purchases_paise", "purchases_paid_paise",
            "supplier_paid_paise", "expenses_paise", "net_cash_paise", "entry_count")
    expect = {  # net = cash sales + collected − purchases paid − supplier paid − expenses
        T.isoformat(): (30000, 0, 0, 0, 0, 0, 11000, 19000, 3),
        day(1): (0, 0, 0, 30000, 30000, 0, 0, -30000, 1),
        day(2): (0, 0, 0, 0, 0, 10000, 0, -10000, 1),
        day(3): (0, 20000, 0, 0, 0, 0, 0, 0, 1),
        day(5): (0, 0, 15000, 0, 0, 0, 0, 15000, 1),
        day(6): (0, 0, 0, 25000, 0, 0, 0, 0, 1),               # bought on credit: no cash moved
        day(7): (20000, 0, 0, 0, 0, 0, 0, 20000, 1),
        day(20): (0, 15000, 0, 0, 0, 0, 0, 0, 1),
    }
    for when, values in expect.items():
        assert tuple(by_day[when][c] for c in cols) == values, when
    quiet = [x for x in d["register"]["days"] if x["day"] not in expect]
    assert len(quiet) == 22 and all(x["entry_count"] == 0 and x["net_cash_paise"] == 0 for x in quiet)

    # Outstanding customer credit, carried in from before the window (Arjun's ₹800 at T-70).
    out = {x["day"]: x["outstanding_credit_paise"] for x in d["register"]["days"]}
    assert out[day(29)] == 80000 and out[day(21)] == 80000
    assert out[day(20)] == 95000 and out[day(5)] == 80000 and out[day(4)] == 80000 and out[day(3)] == 100000
    assert out[T.isoformat()] == 100000
    balances = client.get("/parties?kind=customer", headers=u["headers"]).json()["parties"]
    assert out[T.isoformat()] == sum(p["balance_paise"] for p in balances)      # = party_balances

    # Weekly subtotals: Mon–Sun weeks, only the days shown.
    weeks = d["register"]["weeks"]
    assert weeks[0]["first_day"] == day(29) and weeks[-1]["last_day"] == T.isoformat()
    for w in weeks:
        inside = [x for x in d["register"]["days"] if w["first_day"] <= x["day"] <= w["last_day"]]
        assert all(x["week_start"] == w["week_start"] for x in inside)
        for c in cols:
            assert w[c] == sum(x[c] for x in inside), (w["week_start"], c)
    assert sum(w["net_cash_paise"] for w in weeks) == 19000 - 30000 - 10000 + 15000 + 20000


def test_credit_aging_buckets_and_supplier_dues(client, users):
    u = users.with_shop()
    first = {}
    for age in (0, 7, 8, 30, 31, 60, 61):                  # never paid: age from the first credit
        first[age] = add(client, u, type="credit_given", amount_rupees=100, party_name=f"Age {age:02d}", occurred_on=day(age))
    add(client, u, type="credit_given", amount_rupees=500, party_name="Kavya", occurred_on=day(40))
    add(client, u, type="payment_received", amount_rupees=100, party_name="Kavya", occurred_on=day(10))  # age from here
    add(client, u, type="credit_given", amount_rupees=150, party_name="Ravi", occurred_on=day(20))
    add(client, u, type="payment_received", amount_rupees=150, party_name="Ravi", occurred_on=day(5))    # settled
    void(client, u, add(client, u, type="credit_given", amount_rupees=900, party_name="Zed", occurred_on=day(2)))
    pending(u, type="credit_given", amount_paise=600000, party_id=first[0]["party_id"])
    add(client, u, type="purchase_credit", amount_rupees=1000, party_name="Lotus Agencies", occurred_on=day(45))
    add(client, u, type="payment_made", amount_rupees=400, party_name="Lotus Agencies", occurred_on=day(35))
    void(client, u, add(client, u, type="payment_made", amount_rupees=600, party_name="Lotus Agencies", occurred_on=day(1)))
    add(client, u, type="purchase_credit", amount_rupees=250, party_name="Balaji Stores", occurred_on=day(6))
    add(client, u, type="purchase_paid", amount_rupees=300, party_name="Gupta Traders", occurred_on=day(1))  # owes nothing
    d = dash(client, u)

    rows = {r["display_name"]: r for r in d["aging"]["rows"]}
    assert set(rows) == {"Age 00", "Age 07", "Age 08", "Age 30", "Age 31", "Age 60", "Age 61", "Kavya"}
    assert {n: (r["age_days"], r["bucket"]) for n, r in rows.items()} == {
        "Age 00": (0, "0-7"), "Age 07": (7, "0-7"), "Age 08": (8, "8-30"), "Age 30": (30, "8-30"),
        "Age 31": (31, "31-60"), "Age 60": (60, "31-60"), "Age 61": (61, "60+"), "Kavya": (10, "8-30")}
    k = rows["Kavya"]
    assert (k["balance_paise"], k["first_credit_on"], k["last_payment_on"], k["age_from"]) == (40000, day(40), day(10), day(10))
    assert rows["Age 00"]["balance_paise"] == 10000                     # the ₹6,000 pending credit isn't counted
    assert d["aging"]["rows"][0]["display_name"] == "Kavya"             # largest balance first
    assert d["aging"]["buckets"] == [
        {"bucket": "0-7", "parties": 2, "total_paise": 20000}, {"bucket": "8-30", "parties": 3, "total_paise": 60000},
        {"bucket": "31-60", "parties": 2, "total_paise": 20000}, {"bucket": "60+", "parties": 1, "total_paise": 10000}]

    dues = [(r["display_name"], r["owed_paise"], r["last_payment_on"], r["days"]) for r in d["dues"]["rows"]]
    assert dues == [("Lotus Agencies", 60000, day(35), 35), ("Balaji Stores", 25000, None, 6)]


def test_month_boundary_expense_categories_and_top_customers(client, users):
    u = users.with_shop()
    m0 = T.replace(day=1)
    prev = (m0 - timedelta(days=1)).isoformat()
    add(client, u, type="expense", amount_rupees=1000, expense_category="rent", occurred_on=m0.isoformat())
    add(client, u, type="expense", amount_rupees=500, expense_category="wages", occurred_on=prev)      # last month
    add(client, u, type="expense", amount_rupees=70, expense_category="transport")
    add(client, u, type="expense", amount_rupees=40)                                                   # uncategorised
    void(client, u, add(client, u, type="expense", amount_rupees=999, expense_category="repairs"))
    add(client, u, type="credit_given", amount_rupees=200, party_name="Meena", occurred_on=m0.isoformat())
    add(client, u, type="payment_received", amount_rupees=50, party_name="Meena", occurred_on=m0.isoformat())
    add(client, u, type="credit_given", amount_rupees=700, party_name="Kavya")
    add(client, u, type="credit_given", amount_rupees=300, party_name="Kavya", occurred_on=prev)       # last month
    add(client, u, type="payment_received", amount_rupees=100, party_name="Kavya")
    d = dash(client, u)

    assert d["expenses"]["from"] == m0.isoformat()
    assert [(r["category"], r["total_paise"], r["entry_count"]) for r in d["expenses"]["rows"]] == [
        ("rent", 100000, 1), ("transport", 7000, 1), ("uncategorised", 4000, 1)]
    top = d["top_customers"]
    assert [(r["display_name"], r["credit_given_paise"]) for r in top["by_credit"]] == [("Kavya", 70000), ("Meena", 20000)]
    assert [(r["display_name"], r["collected_paise"]) for r in top["by_collections"]] == [("Kavya", 10000), ("Meena", 5000)]


def test_expense_category_is_expenses_only_and_follows_type_changes(client, users):
    u = users.with_shop()
    e = add(client, u, type="expense", amount_rupees=90, expense_category="electricity")
    assert e["expense_category"] == "electricity"
    bad = client.post("/entries", json={"type": "cash_sale", "amount_rupees": 5, "expense_category": "rent"}, headers=u["headers"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "category_not_expense"
    bad = client.post("/entries", json={"type": "expense", "amount_rupees": 5, "expense_category": "snacks"}, headers=u["headers"])
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "bad_category"
    r = client.patch(f"/entries/{e['id']}", json={"expense_category": "repairs"}, headers=u["headers"]).json()
    assert r["expense_category"] == "repairs"
    r = client.patch(f"/entries/{e['id']}", json={"expense_category": None}, headers=u["headers"]).json()
    assert r["expense_category"] is None                                  # back to "Uncategorised"
    client.patch(f"/entries/{e['id']}", json={"expense_category": "rent"}, headers=u["headers"])
    r = client.patch(f"/entries/{e['id']}", json={"type": "cash_sale"}, headers=u["headers"]).json()
    assert (r["type"], r["expense_category"]) == ("cash_sale", None)      # not an expense any more


@pytest.mark.parametrize("parsed_type, category, stored", [
    ("expense", "electricity", "electricity"),
    ("expense", None, None),
    ("cash_sale", "rent", None),          # the model filled it where it doesn't belong: dropped
])
def test_voice_expense_gets_its_category_from_the_parse(client, users, fake_sarvam, fake_groq, parsed_type, category, stored):
    u = users.with_shop()
    fake_sarvam.transcripts.append("Paid 1200 for the light bill")
    fake_groq.parse_returns({"type": parsed_type, "amount_rupees": 1200, "expense_category": category})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "auto" and r["entry"]["expense_category"] == stored
    schema = fake_groq.calls[0]["response_format"]["json_schema"]["schema"]
    assert "expense_category" in schema["required"] and None in schema["properties"]["expense_category"]["enum"]


def test_dashboard_needs_a_shop(client, users):
    u = users.new()
    assert client.get("/dashboard", headers=u["headers"]).status_code == 409
