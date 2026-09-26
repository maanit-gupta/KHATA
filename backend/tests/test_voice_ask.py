"""P4: voice questions. Real tools against seeded data through the user-scoped client; the Groq
transport is scripted. §12: "How much does Ramesh owe?" in Tamil → spoken Tamil answer whose
number equals party_balances."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from app.db import admin_client, user_client
from app.ledger import today_ist
from app.qa_tools import make_tools, rupees
from app.services import llm_router
from tests.conftest import post_audio

READ_ONLY_TOOLS = {"find_party", "get_party_balance", "list_entries", "get_period_summary", "top_debtors"}


@pytest.fixture
def shop(client, users):
    u = users.with_shop(lang="ta-IN")
    h = u["headers"]
    today = today_ist()

    def add(t, rupees_, name=None, days_ago=0):
        body = {"type": t, "amount_rupees": rupees_, "occurred_on": (today - timedelta(days=days_ago)).isoformat()}
        if name:
            body["party_name"] = name
        assert client.post("/entries", json=body, headers=h).status_code == 201
    add("credit_given", 2300, "Ramesh", 10)
    add("payment_received", 500, "Ramesh", 3)       # Ramesh owes 1800
    add("credit_given", 700, "Lakshmi", 1)
    add("purchase_credit", 1000, "Gupta Traders", 2)
    add("cash_sale", 450.5, days_ago=0)
    add("cash_sale", 1200, days_ago=1)
    add("expense", 300, days_ago=0)
    return u


def _tool_results(kwargs) -> list[dict]:
    return [json.loads(m["content"]) for m in kwargs["messages"] if m["role"] == "tool"]


def _counts(u) -> dict:
    admin = admin_client()
    out = {}
    for table in ("entries", "parties", "receipts", "weekly_insights"):
        out[table] = len(admin.table(table).select("*").eq("shop_id", u["shop_id"]).execute().data)
    out["entries_state"] = sorted((e["id"], e["status"], e["amount_paise"]) for e in
                                  admin.table("entries").select("*").eq("shop_id", u["shop_id"]).execute().data)
    return out


def test_12_5_how_much_does_ramesh_owe_in_tamil(client, shop, fake_sarvam, fake_groq):
    before = _counts(shop)
    fake_sarvam.transcripts.append("How much does Ramesh owe?")

    def handler(kwargs):
        results = _tool_results(kwargs)
        if not results:
            return fake_groq.tools(fake_groq_call("find_party", {"name": "Ramesh"}))
        if len(results) == 1:
            return fake_groq.tools(fake_groq_call("get_party_balance", {"party_id": results[0]["matches"][0]["party_id"]}))
        bal = results[1]
        return fake_groq.text(f"Ramesh owes you {bal['balance_rupees']} rupees.")
    fake_groq.handler = handler

    r = post_audio(client, "/voice/ask", shop["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    ramesh = [p for p in client.get("/parties", headers=shop["headers"]).json()["parties"] if p["display_name"] == "Ramesh"][0]
    assert ramesh["balance_paise"] == 180000
    assert body["text"] == "[ta-IN] Ramesh owes you 1800 rupees."          # Tamil (fake translate), number from SQL
    assert body["audio_b64"] and fake_sarvam.calls[-1][:3] == ("tts", body["text"], "ta-IN")
    assert body["question_en"] == "How much does Ramesh owe?"
    # The model only ever saw read-only tools, and shop_id is never a tool parameter.
    offered = {t["function"]["name"] for t in fake_groq.calls[0]["tools"]}
    assert offered == READ_ONLY_TOOLS
    assert all("shop_id" not in json.dumps(t["function"]["parameters"]) for t in fake_groq.calls[0]["tools"])
    assert fake_groq.calls[0]["model"] == llm_router.QA_MODEL
    # No ledger write happened; the question itself is stored as evidence.
    assert _counts(shop) == before
    note = user_client(shop["token"]).table("voice_notes").select("*").eq("id", body["voice_note_id"]).execute().data[0]
    assert note["purpose"] == "question" and note["transcript_en"] == "How much does Ramesh owe?"


def fake_groq_call(name, args):
    from tests.conftest import tool_call
    return tool_call(name, args)


def test_every_number_in_the_answer_must_come_from_a_tool(client, shop, fake_sarvam, fake_groq):
    fake_sarvam.transcripts.append("How much does Ramesh owe?")

    def handler(kwargs):
        results = _tool_results(kwargs)
        if not results:
            return fake_groq.tools(fake_groq_call("find_party", {"name": "Ramesh"}))
        return fake_groq.text("Ramesh owes you about 2000 rupees.")   # invented, no tool returned 2000
    fake_groq.handler = handler
    body = post_audio(client, "/voice/ask", shop["headers"]).json()
    assert body["text"] == f"[ta-IN] {llm_router.QA_FALLBACK}"


def test_numbers_grounded_unit():
    src = ['{"balance_rupees": 1800, "last_activity": "2026-09-23"}']
    assert llm_router.numbers_grounded("Ramesh owes you 1,800 rupees.", src)
    assert llm_router.numbers_grounded("Ramesh owes you 1800.00 rupees.", src)
    assert not llm_router.numbers_grounded("Ramesh owes you 1850 rupees.", src)
    assert llm_router.numbers_grounded("No numbers here.", src)


def test_delete_request_gets_the_add_button_reply_and_writes_nothing(client, shop, fake_sarvam, fake_groq):
    before = _counts(shop)
    fake_sarvam.transcripts.append("Delete Ramesh's entry")
    fake_groq.script(fake_groq.text("I can't change the ledger. Use the Add button, or open the entry to void it."))
    body = post_audio(client, "/voice/ask", shop["headers"]).json()
    assert "Add button" in body["text"]
    system = fake_groq.calls[0]["messages"][0]["content"]
    assert "You cannot create, edit or delete entries. If asked, tell the user to use the Add button." in system
    assert _counts(shop) == before


def test_ambiguous_name_asks_which_one(client, shop, fake_sarvam, fake_groq):
    # A supplier also called Ramesh: find_party (no kind filter) returns two equal matches.
    client.post("/entries", json={"type": "purchase_credit", "amount_rupees": 50, "party_name": "Ramesh"},
                headers=shop["headers"])
    fake_sarvam.transcripts.append("How much does Ramesh owe?")
    seen = {}

    def handler(kwargs):
        results = _tool_results(kwargs)
        if not results:
            return fake_groq.tools(fake_groq_call("find_party", {"name": "Ramesh"}))
        seen["find"] = results[0]
        names = " or ".join(f"{m['name']} the {m['kind']}" for m in results[0]["matches"])
        return fake_groq.text(f"Which one: {names}?")
    fake_groq.handler = handler
    body = post_audio(client, "/voice/ask", shop["headers"]).json()
    assert len(seen["find"]["matches"]) == 2 and "ask the user which one" in seen["find"]["note"]
    assert body["text"].startswith("[ta-IN] Which one: Ramesh the ")


def test_silence_does_not_call_groq(client, shop, fake_sarvam, fake_groq):
    fake_sarvam.transcripts.append("  ")
    body = post_audio(client, "/voice/ask", shop["headers"]).json()
    assert body["text"] == f"[ta-IN] {llm_router.NOT_HEARD_QUESTION}" and fake_groq.calls == []


def test_groq_busy_is_a_503(client, shop, fake_sarvam, fake_groq):
    import httpx
    from groq import RateLimitError
    fake_sarvam.transcripts.append("How much does Ramesh owe?")

    def handler(kwargs):
        raise RateLimitError("busy", response=httpx.Response(429, request=httpx.Request("POST", "https://x")), body=None)
    fake_groq.handler = handler
    r = post_audio(client, "/voice/ask", shop["headers"])
    assert r.status_code == 503 and r.json()["error"]["message"] == "Service busy, try again."


# --- the tools themselves, against real rows ---------------------------------------------------
def test_tools_return_sql_numbers_in_rupees(shop):
    today = today_ist()
    tools = make_tools(user_client(shop["token"]), today)
    sid = shop["shop_id"]
    found = tools["find_party"](sid, "Ramesh")
    assert found["matches"][0]["name"] == "Ramesh" and "note" not in found
    bal = tools["get_party_balance"](sid, found["matches"][0]["party_id"])
    assert bal == {"name": "Ramesh", "kind": "customer", "balance_rupees": 1800, "who_owes": "they owe the shop",
                   "last_activity": (today - timedelta(days=3)).isoformat()}
    gupta = tools["find_party"](sid, "Gupta Traders")["matches"][0]["party_id"]
    assert tools["get_party_balance"](sid, gupta)["who_owes"] == "the shop owes them"

    week = tools["get_period_summary"](sid, (today - timedelta(days=1)).isoformat(), today.isoformat())
    assert week["cash_sales_rupees"] == 1650.5 and week["expenses_rupees"] == 300
    assert week["credit_given_rupees"] == 700 and week["entry_count"] == 4

    debtors = tools["top_debtors"](sid)["debtors"]
    assert [(d["name"], d["balance_rupees"], d["days_since_last_activity"]) for d in debtors] == \
        [("Ramesh", 1800, 3), ("Lakshmi", 700, 1)]

    listed = tools["list_entries"](sid, type="cash_sale")["entries"]
    assert [e["amount_rupees"] for e in listed] == [450.5, 1200]
    assert tools["find_party"](sid, "Zzyzx") == {"matches": [], "note": "No customer or supplier has a similar name."}


def test_tools_cannot_reach_another_shop(client, users, shop):
    other = users.with_shop("Other")
    client.post("/entries", json={"type": "credit_given", "amount_rupees": 9999, "party_name": "Suresh"},
                headers=other["headers"])
    tools = make_tools(user_client(shop["token"]), today_ist())
    # Even with the other shop's id injected, RLS returns nothing.
    assert tools["find_party"](other["shop_id"], "Suresh")["matches"] == []
    assert tools["top_debtors"](other["shop_id"])["debtors"] == []
    suresh = client.get("/parties", headers=other["headers"]).json()["parties"][0]["party_id"]
    assert tools["get_party_balance"](shop["shop_id"], suresh) == {"error": "no such party"}


def test_rupees_keeps_whole_numbers_whole():
    assert rupees(180000) == 1800 and isinstance(rupees(180000), int)
    assert rupees(45050) == 450.5
    assert rupees(1) == 0.01
