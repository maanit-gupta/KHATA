"""P1.8: inputs are checked before they reach Postgres. A party id from another shop, or of the
wrong kind, is refused (FK checks ignore RLS, so the DB alone would accept it)."""

import pytest


def _party(client, u, name, kind):
    t = "credit_given" if kind == "customer" else "purchase_credit"
    client.post("/entries", json={"type": t, "amount_rupees": 1, "party_name": name}, headers=u["headers"])
    return [p for p in client.get("/parties", headers=u["headers"]).json()["parties"]
            if p["display_name"] == name][0]["party_id"]


def test_foreign_party_id_is_refused(client, users):
    a, b = users.with_shop("A"), users.with_shop("B")
    theirs = _party(client, b, "Ramesh", "customer")
    r = client.post("/entries", json={"type": "credit_given", "amount_rupees": 5, "party_id": theirs},
                    headers=a["headers"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    mine = client.post("/entries", json={"type": "cash_sale", "amount_rupees": 5}, headers=a["headers"]).json()
    r = client.patch(f"/entries/{mine['id']}", json={"type": "credit_given", "party_id": theirs}, headers=a["headers"])
    assert r.status_code == 404
    # B's balance is untouched.
    assert client.get(f"/parties/{theirs}", headers=b["headers"]).json()["balance_paise"] == 100


def test_party_kind_must_match_type(client, users):
    u = users.with_shop()
    supplier = _party(client, u, "Gupta", "supplier")
    r = client.post("/entries", json={"type": "credit_given", "amount_rupees": 5, "party_id": supplier},
                    headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "wrong_party_kind"
    r = client.post("/entries", json={"type": "expense", "amount_rupees": 5, "party_id": supplier},
                    headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "party_not_allowed"
    r = client.post("/entries", json={"type": "purchase_paid", "amount_rupees": 5, "party_id": supplier},
                    headers=u["headers"])
    assert r.status_code == 201


@pytest.mark.parametrize("path", [
    "/entries/123", "/parties/abc", "/receipts/xyz",
])
def test_non_uuid_ids_are_404(client, users, path):
    u = users.with_shop()
    r = client.get(path, headers=u["headers"])
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_bad_date_rejected(client, users):
    u = users.with_shop()
    r = client.post("/entries", json={"type": "cash_sale", "amount_rupees": 1, "occurred_on": "2026-02-30"},
                    headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_date"
