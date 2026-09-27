"""GOAL_2.0 P8 correctness details against the live database: a party's kind is locked once it has
entries (explained), a clashing rename says which party already has the name (so the UI can offer
"Already exists: open it?"), and error bodies keep their {code, message} shape."""

from __future__ import annotations

from app.db import user_client


def _party(client, u, name, kind="customer"):
    t = "credit_given" if kind == "customer" else "purchase_credit"
    return client.post("/entries", json={"type": t, "amount_rupees": 10, "party_name": name}, headers=u["headers"]).json()["party_id"]


def test_kind_is_locked_once_a_party_has_entries(client, users):
    u = users.with_shop()
    pid = _party(client, u, "Ramesh")
    r = client.patch(f"/parties/{pid}", json={"kind": "supplier"}, headers=u["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "kind_in_use"
    assert "has entries, so it stays a customer" in r.json()["error"]["message"]
    # A voided entry still counts: it is part of the record.
    vid = _party(client, u, "Suresh")
    entry = client.get(f"/parties/{vid}", headers=u["headers"]).json()["entries"][0]
    client.post(f"/entries/{entry['id']}/void", headers=u["headers"])
    assert client.patch(f"/parties/{vid}", json={"kind": "supplier"}, headers=u["headers"]).status_code == 409
    # With no entries at all, the kind can change.
    empty = user_client(u["token"]).table("parties").insert({"shop_id": u["shop_id"], "kind": "customer",
                                                               "display_name": "Mahesh", "name_latin": "mahesh"}).execute().data[0]
    r = client.patch(f"/parties/{empty['id']}", json={"kind": "supplier"}, headers=u["headers"])
    assert r.status_code == 200 and r.json()["kind"] == "supplier"


def test_a_clashing_rename_names_the_existing_party(client, users):
    u = users.with_shop()
    ramesh = _party(client, u, "Ramesh")
    other = _party(client, u, "Rames")
    r = client.patch(f"/parties/{other}", json={"display_name": "ramesh"}, headers=u["headers"])
    assert r.status_code == 409
    err = r.json()["error"]
    assert (err["code"], err["party_id"], err["party_name"]) == ("name_taken", ramesh, "Ramesh")
    assert err["message"] == "Ramesh already exists. Open it, or merge the two."
    # The same name as a supplier is a different party: allowed.
    supplier = _party(client, u, "Lotus", kind="supplier")
    assert client.patch(f"/parties/{supplier}", json={"display_name": "Ramesh"}, headers=u["headers"]).status_code == 200
