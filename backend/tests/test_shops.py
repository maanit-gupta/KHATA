import pytest
from postgrest.exceptions import APIError

from app.db import admin_client, user_client


def _create(client, u, name="Lakshmi Stores", lang="ta-IN"):
    return client.post("/shops", json={"name": name, "lang": lang}, headers=u["headers"])


def test_create_shop_then_me_round_trip(client, users):
    owner = users.new()
    resp = _create(client, owner)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    users.track_shop(created["shop"]["id"])
    assert created["shop"]["name"] == "Lakshmi Stores"
    assert created["shop"]["default_lang"] == "ta-IN"      # creator's lang becomes the default
    assert len(created["shop"]["invite_code"]) == 6
    assert created["membership"]["role"] == "owner"
    assert created["membership"]["lang"] == "ta-IN"

    me = client.get("/me", headers=owner["headers"]).json()
    assert me["shop"] == created["shop"]
    assert me["membership"] == created["membership"]


def test_join_with_code(client, users):
    owner, staff = users.new(), users.new()
    shop = _create(client, owner).json()["shop"]
    users.track_shop(shop["id"])
    resp = client.post("/shops/join", json={"code": shop["invite_code"].lower(), "lang": "hi-IN"},
                       headers=staff["headers"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["membership"]["role"] == "staff"
    assert resp.json()["membership"]["lang"] == "hi-IN"
    me = client.get("/me", headers=staff["headers"]).json()
    assert me["shop"]["id"] == shop["id"]
    assert me["shop"]["invite_code"] == shop["invite_code"]  # staff see the code too


def test_bad_invite_code_is_404(client, users):
    u = users.new()
    resp = client.post("/shops/join", json={"code": "ZZZZZZ", "lang": "en-IN"}, headers=u["headers"])
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "bad_invite_code"
    assert client.get("/me", headers=u["headers"]).json()["membership"] is None


def test_member_cannot_create_or_join_another_shop(client, users):
    a, b = users.new(), users.new()
    shop_a = _create(client, a, "Shop A").json()["shop"]
    shop_b = _create(client, b, "Shop B").json()["shop"]
    users.track_shop(shop_a["id"]); users.track_shop(shop_b["id"])

    second = _create(client, a, "Second shop")
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "already_in_shop"

    join = client.post("/shops/join", json={"code": shop_b["invite_code"], "lang": "en-IN"},
                       headers=a["headers"])
    assert join.status_code == 409
    assert client.get("/me", headers=a["headers"]).json()["shop"]["id"] == shop_a["id"]


def test_patch_me_language_and_voice(client, users):
    u = users.new()
    users.track_shop(_create(client, u).json()["shop"]["id"])
    resp = client.patch("/me", json={"lang": "kn-IN", "tts_voice": "neha"}, headers=u["headers"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["lang"] == "kn-IN" and resp.json()["tts_voice"] == "neha"
    assert client.patch("/me", json={"lang": "fr-FR"}, headers=u["headers"]).status_code == 422
    assert client.patch("/me", json={"tts_voice": "varun"}, headers=u["headers"]).status_code == 422
    assert client.patch("/me", json={"role": "owner"}, headers=u["headers"]).status_code == 422


def test_patch_me_before_onboarding_is_409(client, users):
    u = users.new()
    resp = client.patch("/me", json={"lang": "en-IN"}, headers=u["headers"])
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "no_shop"


def test_shop_isolation(client, users):
    a, b = users.new(), users.new()
    shop_a = _create(client, a, "Shop A").json()["shop"]
    shop_b = _create(client, b, "Shop B").json()["shop"]
    users.track_shop(shop_a["id"]); users.track_shop(shop_b["id"])
    db_a = user_client(a["token"])
    assert db_a.table("shops").select("id").eq("id", shop_b["id"]).execute().data == []
    assert db_a.table("shop_members").select("user_id").eq("shop_id", shop_b["id"]).execute().data == []


@pytest.mark.parametrize("column", ["shop_id", "user_id", "role"])
def test_member_cannot_tamper_with_membership(client, users, column):
    """P1.3 / migrations/001_lock_shop_members.sql: a direct PostgREST update of shop_id, user_id
    or role must be refused even though member_self lets the row be updated (lang/tts_voice)."""
    a, b = users.new(), users.new()
    shop_a = _create(client, a, "Shop A").json()["shop"]
    users.track_shop(shop_a["id"])
    users.track_shop(_create(client, b, "Shop B").json()["shop"]["id"])
    staff = users.new()
    client.post("/shops/join", json={"code": shop_a["invite_code"], "lang": "en-IN"}, headers=staff["headers"])
    target_shop = client.get("/me", headers=b["headers"]).json()["shop"]["id"]

    change = {"shop_id": {"shop_id": target_shop}, "user_id": {"user_id": b["id"]},
              "role": {"role": "owner"}}[column]
    with pytest.raises(APIError):
        user_client(staff["token"]).table("shop_members").update(change).eq("user_id", staff["id"]).execute()

    row = admin_client().table("shop_members").select("shop_id, role").eq("user_id", staff["id"]).execute().data[0]
    assert row == {"shop_id": shop_a["id"], "role": "staff"}
    # The allowed columns still work through the same policy.
    ok = user_client(staff["token"]).table("shop_members").update({"lang": "ml-IN"}).eq("user_id", staff["id"]).execute()
    assert ok.data and ok.data[0]["lang"] == "ml-IN"
