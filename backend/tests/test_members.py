"""GOAL_2.0 P4: real member names, the members list, who-did-what attribution, the activity feed,
and live sync (Supabase Realtime delivers a change to members of the same shop only: RLS)."""

from __future__ import annotations

import asyncio

import pytest

from app.db import admin_client, user_client


def _add(client, u, **body):
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


def test_signup_name_becomes_the_member_name_and_can_be_edited(client, users):
    owner = users.with_shop(user_name="Asha")
    staff = users.join(owner)
    assert client.get("/me", headers=owner["headers"]).json()["membership"]["display_name"] == "Asha"
    r = client.patch("/me", json={"display_name": "  Priya  "}, headers=staff["headers"])
    assert r.status_code == 200 and r.json()["display_name"] == "Priya"
    assert client.patch("/me", json={"display_name": "   "}, headers=staff["headers"]).status_code == 422
    body = client.get("/members", headers=owner["headers"]).json()
    assert [(m["name"], m["role"], m["you"]) for m in body["members"]] == [("Asha (you)", "owner", True), ("Priya", "staff", False)]
    assert body["invite_code"] == owner["invite_code"]
    # Staff sees the invite code too (identical permissions), and themselves marked.
    staff_view = client.get("/members", headers=staff["headers"]).json()
    assert staff_view["invite_code"] == owner["invite_code"]
    assert [m["name"] for m in staff_view["members"]] == ["Asha", "Priya (you)"]


def test_a_member_cannot_rename_someone_else(client, users):
    owner = users.with_shop(user_name="Asha")
    staff = users.join(owner)
    db = user_client(staff["token"])
    assert db.table("shop_members").update({"display_name": "Hacked"}).eq("user_id", owner["id"]).execute().data == []
    assert admin_client().table("shop_members").select("display_name").eq("user_id", owner["id"]).execute().data[0]["display_name"] == "Asha"


def test_backfill_fills_only_empty_names(client, users):
    from scripts.backfill_display_names import main
    owner = users.with_shop(user_name="Kamala")
    admin_client().table("shop_members").update({"display_name": None}).eq("user_id", owner["id"]).execute()
    main(dry_run=False)
    assert admin_client().table("shop_members").select("display_name").eq("user_id", owner["id"]).execute().data[0]["display_name"] == "Kamala"


def test_entry_shows_added_by_and_confirmed_by(client, users):
    owner = users.with_shop(user_name="Asha")
    staff = users.join(owner)
    pending = user_client(staff["token"]).table("entries").insert({
        "shop_id": owner["shop_id"], "type": "cash_sale", "amount_paise": 700000, "status": "pending",
        "source": "manual", "created_by": staff["id"]}).execute().data[0]
    client.post(f"/entries/{pending['id']}/confirm", headers=owner["headers"])
    e = client.get(f"/entries/{pending['id']}", headers=staff["headers"]).json()["entry"]
    assert (e["added_by"], e["confirmed_by_name"]) == ("Staff (you)", "Asha")


def test_activity_feed_says_who_did_what_newest_first(client, users):
    owner = users.with_shop(user_name="Asha")
    staff = users.join(owner)
    e = _add(client, staff, type="credit_given", amount_rupees=250, party_name="Ravi")
    client.patch(f"/entries/{e['id']}", json={"amount_rupees": 275}, headers=owner["headers"])
    client.post(f"/entries/{e['id']}/void", headers=owner["headers"])
    feed = client.get("/activity", headers=owner["headers"]).json()["activity"]
    assert [(a["action"], a["by"], a["amount_paise"]) for a in feed] == [
        ("void", "Asha (you)", 27500), ("edit", "Asha (you)", 27500), ("create", "Staff", 25000)]
    assert feed[1]["changed"] == ["amount_paise"] and feed[2]["party_name"] == "Ravi"
    assert len(client.get("/activity?limit=500", headers=owner["headers"]).json()["activity"]) <= 30


# --- live sync through Supabase Realtime (the real service, RLS applied) -----------------------
async def _listen(url: str, key: str, token: str, shop_id: str, got: list, ready: asyncio.Event):
    from realtime import AsyncRealtimeClient
    rt = AsyncRealtimeClient(f"{url.replace('https', 'wss')}/realtime/v1", key, auto_reconnect=False)
    await rt.connect()
    await rt.set_auth(token)
    ch = rt.channel(f"shop-{shop_id}")
    ch.on_postgres_changes("INSERT", schema="public", table="entries", filter=f"shop_id=eq.{shop_id}",
                           callback=lambda p: got.append(p))
    subscribed = asyncio.Event()
    await ch.subscribe(lambda status, err: subscribed.set() if str(status).endswith("SUBSCRIBED") else None)
    await asyncio.wait_for(subscribed.wait(), 20)
    ready.set()
    return rt


def test_realtime_reaches_the_same_shop_and_never_another(client, users):
    """GOAL_2.0 P4.2 AC: B (same shop as A) receives A's new entry live; C (another shop), even
    listening on A's shop id, receives nothing, because Realtime applies RLS to each subscriber."""
    from app.config import get_settings
    s = get_settings()
    a = users.with_shop(user_name="Asha")
    b = users.join(a)
    c = users.with_shop(user_name="Other")

    async def run():
        got_b, got_c = [], []
        rb, rc = asyncio.Event(), asyncio.Event()
        cb = await _listen(s.supabase_url, s.supabase_publishable_key, b["token"], a["shop_id"], got_b, rb)
        cc = await _listen(s.supabase_url, s.supabase_publishable_key, c["token"], a["shop_id"], got_c, rc)
        await asyncio.sleep(2)   # let the subscriptions settle server-side
        await asyncio.to_thread(_add, client, a, type="cash_sale", amount_rupees=42)
        for _ in range(60):
            if got_b:
                break
            await asyncio.sleep(0.25)
        await asyncio.sleep(3)   # give any leak to C time to arrive
        await cb.close()
        await cc.close()
        return got_b, got_c

    got_b, got_c = asyncio.run(run())
    assert got_b, "the same-shop member got no live change"
    record = got_b[0]["data"]["record"]
    assert record["amount_paise"] == 4200 and record["shop_id"] == a["shop_id"] and record["created_by"] == a["id"]
    assert got_c == [], "a member of another shop received shop A's change"
