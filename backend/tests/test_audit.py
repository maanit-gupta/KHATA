"""P1.6: the DB trigger logs create / edit / confirm / void with before, after and the actor
(auth.uid() of the user-scoped request). §12: editing creates an audit row with before/after
and the editor's id."""

from app.db import user_client
from tests.conftest import post_audio


def _audit(u, entry_id):
    return (user_client(u["token"]).table("audit_log").select("*").eq("entry_id", entry_id)
            .order("id").execute().data)


def test_every_action_is_logged_with_actor(client, users, fake_sarvam, fake_groq):
    owner = users.with_shop()
    staff = users.join(owner)

    # create (manual, by owner)
    e = client.post("/entries", json={"type": "credit_given", "amount_rupees": 100, "party_name": "Ramesh"},
                    headers=owner["headers"]).json()
    # edit (by staff)
    r = client.patch(f"/entries/{e['id']}", json={"amount_rupees": 150, "note": "fixed"}, headers=staff["headers"])
    assert r.status_code == 200, r.text
    # void (by owner)
    client.post(f"/entries/{e['id']}/void", headers=owner["headers"])

    rows = _audit(owner, e["id"])
    assert [r["action"] for r in rows] == ["create", "edit", "void"]
    create, edit, void = rows
    assert create["actor"] == owner["id"] and create["before"] is None
    assert create["after"]["amount_paise"] == 10000
    assert edit["actor"] == staff["id"]
    assert edit["before"]["amount_paise"] == 10000 and edit["after"]["amount_paise"] == 15000
    assert edit["before"]["note"] is None and edit["after"]["note"] == "fixed"
    assert void["actor"] == owner["id"]
    assert void["before"]["status"] == "confirmed" and void["after"]["status"] == "voided"

    # History as each member sees it: "you" vs "another member", old → new.
    hist = client.get(f"/entries/{e['id']}", headers=owner["headers"]).json()["history"]
    assert [h["by"] for h in hist] == ["you", "another_member", "you"]
    amount_change = [c for c in hist[1]["changes"] if c["field"] == "amount_paise"][0]
    assert amount_change == {"field": "amount_paise", "old": 10000, "new": 15000}
    staff_view = client.get(f"/entries/{e['id']}", headers=staff["headers"]).json()["history"]
    assert [h["by"] for h in staff_view] == ["another_member", "you", "another_member"]


def test_confirm_is_logged(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    fake_sarvam.transcripts.append("Cash sale 9000")
    fake_groq.parse_returns({"type": "cash_sale", "amount_rupees": 9000})
    entry = post_audio(client, "/voice/entry", u["headers"]).json()["entry"]
    assert entry["status"] == "pending"
    client.post(f"/entries/{entry['id']}/confirm", headers=u["headers"])
    rows = _audit(u, entry["id"])
    assert [r["action"] for r in rows] == ["create", "confirm"]
    assert rows[1]["actor"] == u["id"]
    assert rows[1]["before"]["status"] == "pending" and rows[1]["after"]["status"] == "confirmed"


def test_party_change_shows_names_in_history(client, users):
    u = users.with_shop()
    e = client.post("/entries", json={"type": "credit_given", "amount_rupees": 5, "party_name": "Ramesh"},
                    headers=u["headers"]).json()
    client.patch(f"/entries/{e['id']}", json={"party_name": "Suresh"}, headers=u["headers"])
    hist = client.get(f"/entries/{e['id']}", headers=u["headers"]).json()["history"]
    assert {"field": "party", "old": "Ramesh", "new": "Suresh"} in hist[-1]["changes"]


def test_audit_log_is_not_writable_by_users(client, users):
    u = users.with_shop()
    e = client.post("/entries", json={"type": "cash_sale", "amount_rupees": 5}, headers=u["headers"]).json()
    db = user_client(u["token"])
    import pytest
    from postgrest.exceptions import APIError
    with pytest.raises(APIError):
        db.table("audit_log").insert({"shop_id": u["shop_id"], "entry_id": e["id"], "action": "edit"}).execute()
    # No update/delete policy: the statements match nothing.
    assert db.table("audit_log").delete().eq("entry_id", e["id"]).execute().data == []
    assert len(_audit(u, e["id"])) == 1
