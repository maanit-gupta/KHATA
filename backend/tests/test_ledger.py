"""GOAL_2.0 P3: the ledger table (filters, pagination, totals), the party statement (running
balance in SQL, voided and edited entries), CSV export, and name autocomplete. Live Supabase with
throwaway users; hand-computed expectations."""

from __future__ import annotations

import csv
import io
from datetime import timedelta

import pytest

from app.db import user_client
from app.ledger import today_ist


def _add(client, u, **body):
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


def _day(n: int) -> str:
    return (today_ist() - timedelta(days=n)).isoformat()


@pytest.fixture
def book(client, users):
    """Owner + staff. Known entries (rupees):
    owner: credit_given Kavya 500 (d-10) · payment_received Kavya 120 (d-3) · cash_sale 300 (d-1, note "evening rush")
           expense 80 (today, note "tea for staff") · credit_given Arjun 900 (d-2) VOIDED
    staff: credit_given Arjun 250 (today) · purchase_credit Lotus Agencies 1000 (d-5)
    pending: cash_sale 6000 (today)"""
    owner = users.with_shop(user_name="Asha")
    staff = users.join(owner)
    e = {}
    e["kavya_credit"] = _add(client, owner, type="credit_given", amount_rupees=500, party_name="Kavya", occurred_on=_day(10))
    e["kavya_paid"] = _add(client, owner, type="payment_received", amount_rupees=120, party_name="Kavya", occurred_on=_day(3))
    e["cash"] = _add(client, owner, type="cash_sale", amount_rupees=300, note="evening rush", occurred_on=_day(1))
    e["tea"] = _add(client, owner, type="expense", amount_rupees=80, note="tea for staff")
    e["arjun_void"] = _add(client, owner, type="credit_given", amount_rupees=900, party_name="Arjun", occurred_on=_day(2))
    client.post(f"/entries/{e['arjun_void']['id']}/void", headers=owner["headers"])
    e["arjun"] = _add(client, staff, type="credit_given", amount_rupees=250, party_name="Arjun")
    e["lotus"] = _add(client, staff, type="purchase_credit", amount_rupees=1000, party_name="Lotus Agencies", occurred_on=_day(5))
    e["pending"] = user_client(owner["token"]).table("entries").insert({
        "shop_id": owner["shop_id"], "type": "cash_sale", "amount_paise": 600000, "status": "pending",
        "source": "manual", "created_by": owner["id"]}).execute().data[0]
    return owner, staff, e


def _get(client, u, qs=""):
    r = client.get(f"/ledger{qs}", headers=u["headers"])
    assert r.status_code == 200, r.text
    return r.json()


def test_default_view_hides_voided_and_totals_count_confirmed_only(client, book):
    owner, _, e = book
    body = _get(client, owner)
    ids = [r["id"] for r in body["rows"]]
    assert e["arjun_void"]["id"] not in ids and e["pending"]["id"] in ids and body["total_count"] == 7
    # Newest date first.
    assert [r["occurred_on"] for r in body["rows"]] == sorted((r["occurred_on"] for r in body["rows"]), reverse=True)
    # Pending ₹6,000 cash sale and the voided ₹900 never count.
    assert body["totals"] == {"cash_in_paise": 30000, "credit_given_paise": 75000, "collected_paise": 12000,
                              "expenses_paise": 8000}


def test_voided_only_when_asked(client, book):
    owner, _, e = book
    body = _get(client, owner, "?status=voided")
    assert [r["id"] for r in body["rows"]] == [e["arjun_void"]["id"]]
    assert body["rows"][0]["status"] == "voided"
    assert body["totals"]["credit_given_paise"] == 0            # voided never counts, even when shown
    everything = _get(client, owner, "?status=pending,confirmed,voided")
    assert everything["total_count"] == 8


def test_each_filter(client, book):
    owner, staff, e = book
    assert {r["id"] for r in _get(client, owner, "?type=credit_given")["rows"]} == {e["kavya_credit"]["id"], e["arjun"]["id"]}
    assert {r["id"] for r in _get(client, owner, "?type=cash_sale,expense")["rows"]} == \
        {e["cash"]["id"], e["tea"]["id"], e["pending"]["id"]}
    kavya = e["kavya_credit"]["party_id"]
    assert {r["id"] for r in _get(client, owner, f"?party={kavya}")["rows"]} == {e["kavya_credit"]["id"], e["kavya_paid"]["id"]}
    assert _get(client, owner, "?source=voice")["rows"] == []
    staff_rows = _get(client, owner, f"?member={staff['id']}")["rows"]
    assert {r["id"] for r in staff_rows} == {e["arjun"]["id"], e["lotus"]["id"]}
    # Date range: the last 3 days (d-3 … today) and a single past day.
    recent = {r["id"] for r in _get(client, owner, f"?from={_day(3)}&to={_day(0)}")["rows"]}
    assert recent == {e["kavya_paid"]["id"], e["cash"]["id"], e["tea"]["id"], e["arjun"]["id"], e["pending"]["id"]}
    assert [r["id"] for r in _get(client, owner, f"?from={_day(5)}&to={_day(5)}")["rows"]] == [e["lotus"]["id"]]


def test_search_covers_party_names_and_notes(client, book):
    owner, _, e = book
    assert {r["id"] for r in _get(client, owner, "?q=kav")["rows"]} == {e["kavya_credit"]["id"], e["kavya_paid"]["id"]}
    assert [r["id"] for r in _get(client, owner, "?q=TEA for")["rows"]] == [e["tea"]["id"]]
    assert [r["id"] for r in _get(client, owner, "?q=lotus")["rows"]] == [e["lotus"]["id"]]


def test_added_by_names_the_member_with_you_after_your_own(client, book):
    owner, staff, e = book
    rows = {r["id"]: r for r in _get(client, owner)["rows"]}
    assert rows[e["tea"]["id"]]["added_by"] == "Asha (you)"
    assert rows[e["arjun"]["id"]]["added_by"] == "Staff"       # the staff user's sign-up name, from the backfill/signup
    assert {m["name"] for m in _get(client, owner)["members"]} == {"Asha (you)", "Staff"}


def test_bad_filters_are_refused(client, book):
    owner, _, _ = book
    for qs, code in (("?type=gift", "bad_type"), ("?status=deleted", "bad_status"), ("?source=fax", "bad_source"),
                     (f"?from={_day(0)}&to={_day(3)}", "bad_range"), ("?from=26-09-2026", "bad_date")):
        r = client.get(f"/ledger{qs}", headers=owner["headers"])
        assert r.status_code == 422 and r.json()["error"]["code"] == code, qs


def test_pagination_50_per_page(client, users):
    u = users.with_shop()
    db = user_client(u["token"])
    db.table("entries").insert([{"shop_id": u["shop_id"], "type": "cash_sale", "amount_paise": 100 * (i + 1),
                                 "status": "confirmed", "confirmed_at": "2026-09-26T10:00:00+05:30", "source": "manual",
                                 "occurred_on": _day(i % 20), "created_by": u["id"]} for i in range(57)]).execute()
    p1, p2 = _get(client, u, "?page=1"), _get(client, u, "?page=2")
    assert (p1["total_count"], p1["pages"], len(p1["rows"]), len(p2["rows"])) == (57, 2, 50, 7)
    assert not {r["id"] for r in p1["rows"]} & {r["id"] for r in p2["rows"]}
    # The totals row covers the whole filtered set, not just the page: 1+2+…+57 rupees.
    assert p1["totals"]["cash_in_paise"] == 100 * 57 * 58 // 2
    assert _get(client, u, "?page=3")["rows"] == []


def test_csv_export_matches_the_filtered_view(client, book):
    owner, _, e = book
    r = client.get(f"/ledger/export.csv?from={_day(3)}&to={_day(0)}", headers=owner["headers"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"].startswith('attachment; filename="khata-ledger-')
    assert r.text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0] == ["Date", "Party", "Type", "Amount (₹)", "Source", "Added by", "Status", "Note", "Recorded at (IST)"]
    body = rows[1:]
    assert len(body) == 5
    tea = next(x for x in body if x[7] == "tea for staff")
    assert tea[:7] == [_day(0), "", "Expense", "80.00", "Typed", "Asha (you)", "Confirmed"]
    assert next(x for x in body if x[1] == "Kavya")[3] == "120.00"
    assert next(x for x in body if x[6] == "Pending")[3] == "6000.00"
    assert len(tea[8]) == 16 and tea[8][:4] == _day(0)[:4]      # "YYYY-MM-DD HH:MM", IST


def test_statement_running_balance_with_voids_and_edits(client, users):
    u = users.with_shop()
    a = _add(client, u, type="credit_given", amount_rupees=100, party_name="Irfan", occurred_on=_day(6))
    pid = a["party_id"]
    b = _add(client, u, type="payment_received", amount_rupees=30, party_name="Irfan", occurred_on=_day(4))
    v = _add(client, u, type="credit_given", amount_rupees=50, party_name="Irfan", occurred_on=_day(3))
    client.post(f"/entries/{v['id']}/void", headers=u["headers"])                 # never counts
    client.patch(f"/entries/{a['id']}", json={"amount_rupees": 120}, headers=u["headers"])   # edited 100 → 120
    c = _add(client, u, type="credit_given", amount_rupees=45.5, party_name="Irfan", occurred_on=_day(1))
    st = client.get(f"/parties/{pid}/statement", headers=u["headers"]).json()
    assert [(r["entry_id"], r["delta_paise"], r["running_balance_paise"]) for r in st["rows"]] == [
        (a["id"], 12000, 12000), (b["id"], -3000, 9000), (c["id"], 4550, 13550)]
    assert st["opening_balance_paise"] == 0 and st["closing_balance_paise"] == 13550
    # Same as party_balances (the only source of balances).
    assert client.get(f"/parties/{pid}", headers=u["headers"]).json()["balance_paise"] == 13550
    # A date filter keeps true running balances and states the opening balance.
    part = client.get(f"/parties/{pid}/statement?from={_day(4)}&to={_day(2)}", headers=u["headers"]).json()
    assert part["opening_balance_paise"] == 12000
    assert [(r["entry_id"], r["running_balance_paise"]) for r in part["rows"]] == [(b["id"], 9000)]
    assert part["closing_balance_paise"] == 9000


def test_supplier_statement_sign(client, users):
    u = users.with_shop()
    p = _add(client, u, type="purchase_credit", amount_rupees=700, party_name="Delta Foods", occurred_on=_day(2))
    _add(client, u, type="payment_made", amount_rupees=200, party_name="Delta Foods", occurred_on=_day(1))
    st = client.get(f"/parties/{p['party_id']}/statement", headers=u["headers"]).json()
    assert [r["running_balance_paise"] for r in st["rows"]] == [-70000, -50000]   # − = the shop owes them


def test_suggest_uses_find_party_then_prefix(client, users):
    u = users.with_shop()
    for name in ("Rajesh", "Rajiv", "Meenakshi"):
        _add(client, u, type="credit_given", amount_rupees=1, party_name=name)
    _add(client, u, type="purchase_credit", amount_rupees=1, party_name="Rajdhani Traders")
    names = lambda qs: [p["display_name"] for p in client.get(f"/parties/suggest?{qs}", headers=u["headers"]).json()["parties"]]  # noqa: E731
    assert set(names("q=Raj&kind=customer")) == {"Rajesh", "Rajiv"}
    assert "Rajdhani Traders" in names("q=Raj")
    assert names("q=Rajesh&kind=customer")[0] == "Rajesh"             # exact/fuzzy match first
    assert names("q=Minakshi&kind=customer") == ["Meenakshi"]          # fuzzy, not prefix
    assert names("q=") == []
