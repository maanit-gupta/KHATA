"""P1.2 tenant isolation. User A (shop A) must not read or write anything of shop B:
- through every API route (CASES below; test_every_route_is_covered keeps the list complete),
- through every table and view with the user-scoped client (RLS),
- through Storage (no signed URL for B's audio or bill photo).
§12: "User A in shop 1 cannot read any row of shop 2"."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from postgrest.exceptions import APIError

from app.db import admin_client, user_client
from app.storage import upload
from tests.conftest import AUDIO, Users, api_routes, post_audio

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(scope="module")
def world(client):
    u = Users(client)
    try:
        a = u.with_shop("Shop A")
        b = u.with_shop("Shop B")
        db_b = user_client(b["token"])

        def add(who, **body):
            r = client.post("/entries", json=body, headers=who["headers"])
            assert r.status_code == 201, r.text
            return r.json()

        a_entry = add(a, type="credit_given", amount_rupees=10, party_name="Ramesh")
        b_entry = add(b, type="credit_given", amount_rupees=100, party_name="Ramesh")
        add(b, type="credit_given", amount_rupees=100, party_name="Suresh")
        b_pending = db_b.table("entries").insert({
            "shop_id": b["shop_id"], "type": "cash_sale", "amount_paise": 600000, "status": "pending",
            "source": "manual", "review_reason": "amount above ₹5,000"}).execute().data[0]
        b_flagged = db_b.table("parties").insert({
            "shop_id": b["shop_id"], "kind": "customer", "display_name": "Mahesh", "name_latin": "mahesh",
            "needs_review": True}).execute().data[0]
        db_b.table("party_aliases").insert({"party_id": b_entry["party_id"], "alias_latin": "rames"}).execute()
        audio_path = upload("voice", b["shop_id"], AUDIO, "audio/webm", "webm")
        b_note = db_b.table("voice_notes").insert({
            "shop_id": b["shop_id"], "audio_path": audio_path, "spoken_lang": "en-IN", "purpose": "entry",
            "transcript_en": "Ramesh 100", "parsed": {"type": "credit_given", "party_name": "Rakesh",
                                                      "amount_paise": 10000}}).execute().data[0]
        image_path = upload("receipts", b["shop_id"], PNG, "image/png", "png")
        b_receipt = db_b.table("receipts").insert({
            "shop_id": b["shop_id"], "image_path": image_path, "kind": "supplier", "settled": False,
            "ocr_lang_first": "en-IN", "status": "failed", "error": "could not read"}).execute().data[0]
        db_b.table("weekly_insights").insert({
            "shop_id": b["shop_id"], "week_start": "2026-09-21", "metrics": {"x": 1},
            "narration_en": "B's week"}).execute()
        a_party = [p for p in client.get("/parties", headers=a["headers"]).json()["parties"]][0]["party_id"]
        yield SimpleNamespace(
            a=a, b=b, a_party=a_party, a_entry=a_entry, b_entry=b_entry, b_party=b_entry["party_id"],
            b_pending=b_pending, b_flagged=b_flagged, b_note=b_note, b_receipt=b_receipt,
            audio_path=audio_path, image_path=image_path)
    finally:
        u.cleanup()


def _b_ids(w) -> set[str]:
    return {w.b_entry["id"], w.b_party, w.b_pending["id"], w.b_flagged["id"], w.b_note["id"],
            w.b_receipt["id"], w.b["shop_id"]}


def _no_b(w, payload) -> None:
    text = str(payload)
    leaked = [i for i in _b_ids(w) if i in text]
    assert not leaked, f"shop B ids leaked: {leaked}"


def _is_404(resp):
    assert resp.status_code == 404, resp.text
    assert resp.json()["error"]["code"] in ("not_found", "bad_invite_code")


# --- API: one case per route ------------------------------------------------------------------
def c_me(client, w):
    r = client.get("/me", headers=w.a["headers"]).json()
    assert r["shop"]["id"] == w.a["shop_id"]
    _no_b(w, r)


def c_patch_me(client, w):
    r = client.patch("/me", json={"lang": "hi-IN"}, headers=w.a["headers"])
    assert r.status_code == 200 and r.json()["shop_id"] == w.a["shop_id"]
    b_row = admin_client().table("shop_members").select("lang").eq("user_id", w.b["id"]).execute().data[0]
    assert b_row["lang"] == "en-IN"


def c_create_shop(client, w):
    assert client.post("/shops", json={"name": "x", "lang": "en-IN"}, headers=w.a["headers"]).status_code == 409


def c_join_shop(client, w):
    r = client.post("/shops/join", json={"code": w.b["invite_code"], "lang": "en-IN"}, headers=w.a["headers"])
    assert r.status_code == 409  # one shop per user: A can't hop into B even with B's code


def c_list_parties(client, w):
    for q in ("", "?q=Ramesh", "?kind=customer", "?q=Mahesh"):
        _no_b(w, client.get(f"/parties{q}", headers=w.a["headers"]).json())


def c_get_party(client, w):
    _is_404(client.get(f"/parties/{w.b_party}", headers=w.a["headers"]))


def c_patch_party(client, w):
    _is_404(client.patch(f"/parties/{w.b_party}", json={"display_name": "Hacked"}, headers=w.a["headers"]))
    row = admin_client().table("parties").select("display_name").eq("id", w.b_party).execute().data[0]
    assert row["display_name"] == "Ramesh"


def c_merge_party(client, w):
    _is_404(client.post(f"/parties/{w.b_party}/merge", json={"into_party_id": w.a_party}, headers=w.a["headers"]))
    _is_404(client.post(f"/parties/{w.a_party}/merge", json={"into_party_id": w.b_party}, headers=w.a["headers"]))
    assert admin_client().table("entries").select("id").eq("party_id", w.b_party).execute().data


def c_list_entries(client, w):
    for q in ("", "?status=pending", "?limit=100"):
        _no_b(w, client.get(f"/entries{q}", headers=w.a["headers"]).json())


def c_create_entry(client, w):
    r = client.post("/entries", json={"type": "credit_given", "amount_rupees": 1, "party_id": w.b_party},
                    headers=w.a["headers"])
    _is_404(r)


def c_get_entry(client, w):
    _is_404(client.get(f"/entries/{w.b_entry['id']}", headers=w.a["headers"]))


def c_patch_entry(client, w):
    _is_404(client.patch(f"/entries/{w.b_entry['id']}", json={"amount_rupees": 1}, headers=w.a["headers"]))
    row = admin_client().table("entries").select("amount_paise").eq("id", w.b_entry["id"]).execute().data[0]
    assert row["amount_paise"] == 10000


def c_confirm_entry(client, w):
    _is_404(client.post(f"/entries/{w.b_pending['id']}/confirm", headers=w.a["headers"]))
    row = admin_client().table("entries").select("status").eq("id", w.b_pending["id"]).execute().data[0]
    assert row["status"] == "pending"


def c_void_entry(client, w):
    _is_404(client.post(f"/entries/{w.b_entry['id']}/void", headers=w.a["headers"]))
    row = admin_client().table("entries").select("status").eq("id", w.b_entry["id"]).execute().data[0]
    assert row["status"] == "confirmed"


def c_voice_entry(client, w, fake_sarvam, fake_groq):
    # "Suresh" exists only in shop B. A's voice entry must not match it: A gets a new flagged party.
    fake_sarvam.transcripts.append("Suresh took 20 on credit")
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Suresh", "amount_rupees": 20})
    r = post_audio(client, "/voice/entry", w.a["headers"]).json()
    _no_b(w, r)
    assert r["decision"] == "auto" and r["suggestion"] is None
    assert r["entry"]["shop_id"] == w.a["shop_id"]


def c_resolve(client, w):
    r = client.post("/voice/entry/resolve", json={"voice_note_id": w.b_note["id"], "choice": "create_new"},
                    headers=w.a["headers"])
    _is_404(r)
    # A clarify answer can't be joined onto B's recording either.
    r = client.post("/voice/entry", files={"audio": ("n.webm", AUDIO, "audio/webm")},
                    data={"answer_to": w.b_note["id"]}, headers=w.a["headers"])
    _is_404(r)


def c_voice_ask(client, w, fake_sarvam, fake_groq):
    """The model asks for B's party by name and then by B's party id: the tools (A's RLS client,
    A's shop_id injected) return nothing of B's."""
    from tests.conftest import tool_call
    fake_sarvam.transcripts.append("How much does Mahesh owe?")   # Mahesh exists only in shop B
    seen = []

    def handler(kwargs):
        results = [m["content"] for m in kwargs["messages"] if m["role"] == "tool"]
        seen.extend(results[len(seen):])
        if not results:
            return fake_groq.tools(tool_call("find_party", {"name": "Mahesh"}))
        if len(results) == 1:
            return fake_groq.tools(tool_call("get_party_balance", {"party_id": w.b_party}),
                                   tool_call("top_debtors", {}), tool_call("list_entries", {"party_id": w.b_party}))
        return fake_groq.text("I could not find Mahesh.")
    fake_groq.handler = handler
    r = post_audio(client, "/voice/ask", w.a["headers"])
    assert r.status_code == 200, r.text
    _no_b(w, seen)
    assert '"matches": []' in seen[0] and '"error": "no such party"' in seen[1]
    assert "Mahesh" not in seen[2] and '"entries": []' in seen[3]


def c_insights(client, w, fake_groq):
    fake_groq.script(fake_groq.text("No numbers here."))
    body = client.get("/insights/weekly", headers=w.a["headers"]).json()
    _no_b(w, body)
    # B's credit (₹200 this week) never reaches A's figures; A's own entries are ₹10 (+ voice ₹20).
    assert body["this_week"]["credit_given_paise"] in (1000, 3000)
    assert all(d["party_id"] not in (w.b_party,) for d in body["top_debtors"])


def c_get_receipt(client, w):
    _is_404(client.get(f"/receipts/{w.b_receipt['id']}", headers=w.a["headers"]))


def c_save_receipt(client, w):
    _is_404(client.post(f"/receipts/{w.b_receipt['id']}/save", json={"vendor_name": "X", "total_rupees": 5},
                        headers=w.a["headers"]))
    assert not admin_client().table("entries").select("id").eq("receipt_id", w.b_receipt["id"]).execute().data


def c_review(client, w):
    _no_b(w, client.get("/review", headers=w.a["headers"]).json())


def c_media(client, w):
    _is_404(client.get(f"/media/voice/{w.b_note['id']}", headers=w.a["headers"]))
    _is_404(client.get(f"/media/receipts/{w.b_receipt['id']}", headers=w.a["headers"]))
    # And B itself can: proves the 404 above is isolation, not a broken route.
    assert client.get(f"/media/voice/{w.b_note['id']}", headers=w.b["headers"]).json()["url"].startswith("http")


def c_tts(client, w, fake_sarvam):
    r = client.post("/tts", json={"text": "Ramesh owes you 250 rupees."}, headers=w.a["headers"])
    assert r.status_code == 200
    assert fake_sarvam.calls[-1][0] == "tts"


def c_ledger(client, w):
    for q in ("", "?q=Ramesh", "?status=pending,confirmed,voided", f"?party={w.a_party}"):
        r = client.get(f"/ledger{q}", headers=w.a["headers"])
        assert r.status_code == 200, r.text
        _no_b(w, r.json())
    # Asking for B's party or B's member id finds nothing.
    assert client.get(f"/ledger?party={w.b_party}", headers=w.a["headers"]).json()["rows"] == []
    assert client.get(f"/ledger?member={w.b['id']}", headers=w.a["headers"]).json()["rows"] == []
    assert client.get("/ledger", headers=w.b["headers"]).json()["total_count"] >= 2   # B sees its own


def c_ledger_csv(client, w):
    r = client.get("/ledger/export.csv?status=pending,confirmed,voided", headers=w.a["headers"])
    assert r.status_code == 200 and "Ramesh" in r.text
    _no_b(w, r.text)
    assert "Suresh" not in r.text and "100.00" not in r.text                       # B's rows


def c_suggest(client, w):
    r = client.get("/parties/suggest?q=Sures", headers=w.a["headers"]).json()
    assert r["parties"] == []                                                      # Suresh is B's
    _no_b(w, client.get("/parties/suggest?q=Rames", headers=w.a["headers"]).json())


def c_statement(client, w):
    _is_404(client.get(f"/parties/{w.b_party}/statement", headers=w.a["headers"]))
    assert client.get(f"/parties/{w.a_party}/statement", headers=w.a["headers"]).status_code == 200


def c_members(client, w):
    r = client.get("/members", headers=w.a["headers"]).json()
    assert [m["user_id"] for m in r["members"]] == [w.a["id"]] and r["invite_code"] == w.a["invite_code"]
    _no_b(w, r)
    assert w.b["invite_code"] not in str(r)


def c_activity(client, w):
    r = client.get("/activity", headers=w.a["headers"]).json()
    assert r["activity"] and all(a["entry_id"] == w.a_entry["id"] for a in r["activity"])
    _no_b(w, r)


CASES = {
    ("GET", "/me"): c_me,
    ("PATCH", "/me"): c_patch_me,
    ("POST", "/shops"): c_create_shop,
    ("POST", "/shops/join"): c_join_shop,
    ("GET", "/parties"): c_list_parties,
    ("GET", "/parties/{party_id}"): c_get_party,
    ("PATCH", "/parties/{party_id}"): c_patch_party,
    ("POST", "/parties/{party_id}/merge"): c_merge_party,
    ("GET", "/entries"): c_list_entries,
    ("POST", "/entries"): c_create_entry,
    ("GET", "/entries/{entry_id}"): c_get_entry,
    ("PATCH", "/entries/{entry_id}"): c_patch_entry,
    ("POST", "/entries/{entry_id}/confirm"): c_confirm_entry,
    ("POST", "/entries/{entry_id}/void"): c_void_entry,
    ("POST", "/voice/entry"): c_voice_entry,
    ("POST", "/voice/entry/resolve"): c_resolve,
    ("POST", "/voice/ask"): c_voice_ask,
    ("GET", "/receipts/{receipt_id}"): c_get_receipt,
    ("POST", "/receipts/{receipt_id}/save"): c_save_receipt,
    ("GET", "/review"): c_review,
    ("GET", "/insights/weekly"): c_insights,
    ("GET", "/media/{bucket}/{item_id}"): c_media,
    ("POST", "/tts"): c_tts,
    # GOAL_2.0 routes
    ("GET", "/ledger"): c_ledger,
    ("GET", "/ledger/export.csv"): c_ledger_csv,
    ("GET", "/parties/suggest"): c_suggest,
    ("GET", "/parties/{party_id}/statement"): c_statement,
    ("GET", "/members"): c_members,
    ("GET", "/activity"): c_activity,
}
# Routes that act only on the caller's own shop by construction (shop_id comes from the caller's
# membership, never from the request) and have no B-owned id to aim at. Each has a reason.
OWN_SHOP_ONLY = {
    ("GET", "/health"): "public, no data",
    ("POST", "/receipts"): "creates a receipt in the caller's shop; B's rows are covered by GET/save",
}


# CLAUDE.md §6.5, every row (plus /health).
SPEC_ROUTES = {
    ("GET", "/health"), ("GET", "/me"), ("PATCH", "/me"), ("POST", "/shops"), ("POST", "/shops/join"),
    ("GET", "/parties"), ("GET", "/parties/{party_id}"), ("PATCH", "/parties/{party_id}"),
    ("POST", "/parties/{party_id}/merge"), ("GET", "/entries"), ("POST", "/entries"),
    ("GET", "/entries/{entry_id}"), ("PATCH", "/entries/{entry_id}"), ("POST", "/entries/{entry_id}/confirm"),
    ("POST", "/entries/{entry_id}/void"), ("POST", "/voice/entry"), ("POST", "/voice/entry/resolve"),
    ("POST", "/voice/ask"), ("POST", "/receipts"), ("GET", "/receipts/{receipt_id}"),
    ("POST", "/receipts/{receipt_id}/save"), ("GET", "/insights/weekly"), ("POST", "/tts"), ("GET", "/review"),
    ("GET", "/media/{bucket}/{item_id}"),
} | {  # GOAL_2.0 additions (CLAUDE.md §6.5 is updated with each)
    ("GET", "/ledger"), ("GET", "/ledger/export.csv"), ("GET", "/parties/suggest"),
    ("GET", "/parties/{party_id}/statement"), ("GET", "/members"), ("GET", "/activity"),
}


def test_app_serves_exactly_the_spec_routes():
    assert api_routes() == SPEC_ROUTES


def test_every_route_is_covered():
    routes = api_routes()
    assert len(routes) >= 25 and len(routes) == len(SPEC_ROUTES)   # a walker that finds nothing fails here
    missing = routes - set(CASES) - set(OWN_SHOP_ONLY)
    assert not missing, f"add an isolation case for: {sorted(missing)}"


@pytest.mark.parametrize("route", sorted(CASES), ids=lambda r: f"{r[0]} {r[1]}")
def test_route_isolation(route, client, world, fake_sarvam, fake_groq):
    fn = CASES[route]
    kwargs = {k: v for k, v in {"fake_sarvam": fake_sarvam, "fake_groq": fake_groq}.items()
              if k in fn.__code__.co_varnames[:fn.__code__.co_argcount]}
    fn(client, world, **kwargs)


# --- Tables and views through the user-scoped client -------------------------------------------
SHOP_TABLES = ["parties", "receipts", "voice_notes", "entries", "audit_log", "weekly_insights",
               "party_balances", "daily_summary", "review_queue", "shop_members",
               # migration 003
               "ai_reports", "daily_briefings", "party_statement", "daily_register", "weekly_register",
               "credit_aging", "credit_aging_totals", "supplier_dues"]


@pytest.mark.parametrize("fn, extra", [
    ("ledger_rows", {}), ("ledger_totals", {}),
    ("expense_by_category", {"p_from": "2000-01-01", "p_to": "2100-01-01"}),
    ("party_period_totals", {"p_from": "2000-01-01", "p_to": "2100-01-01"}),
    ("expense_category_weeks", {"p_week_start": "2026-09-21", "p_today": "2026-09-26"}),
    ("customer_credit_usual", {"p_month_start": "2026-09-01", "p_today": "2026-09-26"}),
])
def test_a_gets_nothing_from_bs_shop_through_the_sql_functions(world, fn, extra):
    """Migration 003's functions are security invoker: asked for shop B, A's RLS returns nothing."""
    db = user_client(world.a["token"])
    rows = db.rpc(fn, {"p_shop": world.b["shop_id"], **extra}).execute().data
    if fn == "ledger_totals":
        assert rows[0]["row_count"] == 0 and rows[0]["credit_given_paise"] == 0
    else:
        assert rows == []
    mine = user_client(world.b["token"]).rpc(fn, {"p_shop": world.b["shop_id"], **extra}).execute().data
    if fn in ("ledger_rows", "party_period_totals"):
        assert mine, "B should see its own rows (proves the empty answer above is isolation)"


@pytest.mark.parametrize("table", SHOP_TABLES + ["shops", "party_aliases"])
def test_a_cannot_read_b_rows(world, table):
    db = user_client(world.a["token"])
    if table == "shops":
        rows = db.table("shops").select("*").eq("id", world.b["shop_id"]).execute().data
    elif table == "party_aliases":
        rows = db.table("party_aliases").select("*").eq("party_id", world.b_party).execute().data
    else:
        rows = db.table(table).select("*").eq("shop_id", world.b["shop_id"]).execute().data
    assert rows == []
    # Unfiltered reads return only A's rows.
    all_rows = db.table(table).select("*").execute().data
    _no_b(world, all_rows)


@pytest.mark.parametrize("table, row", [
    ("parties", lambda w: {"shop_id": w.b["shop_id"], "kind": "customer", "display_name": "X", "name_latin": "x"}),
    ("entries", lambda w: {"shop_id": w.b["shop_id"], "type": "cash_sale", "amount_paise": 1, "source": "manual"}),
    ("receipts", lambda w: {"shop_id": w.b["shop_id"], "image_path": "x", "kind": "expense", "ocr_lang_first": "en-IN"}),
    ("voice_notes", lambda w: {"shop_id": w.b["shop_id"], "audio_path": "x", "spoken_lang": "en-IN", "purpose": "entry"}),
    ("weekly_insights", lambda w: {"shop_id": w.b["shop_id"], "week_start": "2026-01-05", "metrics": {}, "narration_en": "x"}),
    ("party_aliases", lambda w: {"party_id": w.b_party, "alias_latin": "evil"}),
    ("audit_log", lambda w: {"shop_id": w.b["shop_id"], "entry_id": w.b_entry["id"], "action": "edit"}),
    ("shops", lambda w: {"name": "Mine now"}),
    ("shop_members", lambda w: {"shop_id": w.b["shop_id"], "user_id": w.a["id"], "role": "owner", "lang": "en-IN"}),
])
def test_a_cannot_insert_into_b(world, table, row):
    with pytest.raises(APIError):
        user_client(world.a["token"]).table(table).insert(row(world)).execute()


@pytest.mark.parametrize("table, id_col, id_attr, change", [
    ("parties", "id", "b_party", {"display_name": "Hacked"}),
    ("entries", "id", "b_entry.id", {"amount_paise": 1}),
    ("receipts", "id", "b_receipt.id", {"vendor_name": "Hacked"}),
    ("voice_notes", "id", "b_note.id", {"transcript_en": "Hacked"}),
    ("shops", "id", "b.shop_id", {"name": "Hacked"}),
    ("shop_members", "user_id", "b.id", {"lang": "ta-IN"}),
    ("weekly_insights", "shop_id", "b.shop_id", {"narration_en": "Hacked"}),
])
def test_a_cannot_update_or_delete_b(world, table, id_col, id_attr, change):
    obj = world
    for part in id_attr.split("."):
        obj = obj[part] if isinstance(obj, dict) else getattr(obj, part)
    db = user_client(world.a["token"])
    assert db.table(table).update(change).eq(id_col, obj).execute().data == []
    assert db.table(table).delete().eq(id_col, obj).execute().data == []
    still = admin_client().table(table).select("*").eq(id_col, obj).execute().data
    assert still, f"{table} row was deleted"
    for k, v in change.items():
        assert still[0][k] != v, f"{table}.{k} was changed"


def test_a_cannot_touch_b_storage(world):
    """Buckets are private with no storage policies: a user token can't sign or read B's files."""
    db = user_client(world.a["token"])
    for bucket, path in (("voice", world.audio_path), ("receipts", world.image_path)):
        with pytest.raises(Exception):
            res = db.storage.from_(bucket).create_signed_url(path, 60)
            if not (res.get("signedURL") or res.get("signedUrl")):
                raise RuntimeError("no url")
        with pytest.raises(Exception):
            db.storage.from_(bucket).download(path)
