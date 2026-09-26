"""P1.4 money invariants: integer paise, balances only from party_balances, voids excluded,
edits move balances, exact rupee↔paise conversion, and the ₹5,000 auto-save cap."""

import pytest

from app.errors import AppError
from app.ledger import rupees_to_paise
from app.services import llm_router
from tests.conftest import post_audio


def _add(client, u, **body):
    r = client.post("/entries", json=body, headers=u["headers"])
    assert r.status_code == 201, r.text
    return r.json()


def _balances(client, u) -> dict:
    r = client.get("/parties", headers=u["headers"])
    assert r.status_code == 200, r.text
    return {p["display_name"]: p["balance_paise"] for p in r.json()["parties"]}


# --- pure conversion -------------------------------------------------------------------------
@pytest.mark.parametrize("rupees, paise", [
    (0.10, 10), (0.01, 1), (1250.50, 125050), (5000, 500000), (5000.01, 500001),
    ("99999.99", 9999999), (1, 100), (0.29, 29),
])
def test_rupees_to_paise_is_exact(rupees, paise):
    assert rupees_to_paise(rupees) == paise
    assert isinstance(rupees_to_paise(rupees), int)


@pytest.mark.parametrize("bad", [0, -5, 10.005, "abc", float("nan"), float("inf"), 1e12])
def test_rupees_to_paise_rejects(bad):
    with pytest.raises(AppError) as e:
        rupees_to_paise(bad)
    assert e.value.status == 422


# --- balances across all 7 entry types -------------------------------------------------------
def test_balance_math_all_types_and_voids(client, users):
    u = users.with_shop()
    _add(client, u, type="credit_given", amount_rupees=500, party_name="Ramesh")          # +500
    pay = _add(client, u, type="payment_received", amount_rupees=200, party_name="Ramesh")  # -200
    _add(client, u, type="purchase_credit", amount_rupees=1000, party_name="Gupta Traders")  # -1000
    _add(client, u, type="payment_made", amount_rupees=400, party_name="Gupta Traders")      # +400
    gupta = [p for p in client.get("/parties", headers=u["headers"]).json()["parties"]
             if p["display_name"] == "Gupta Traders"][0]["party_id"]
    _add(client, u, type="purchase_paid", amount_rupees=250, party_id=gupta)  # linked, no effect
    _add(client, u, type="cash_sale", amount_rupees=999.99)                    # no party, no effect
    _add(client, u, type="expense", amount_rupees=120, note="Electricity")      # no party, no effect

    b = _balances(client, u)
    assert b == {"Ramesh": 30000, "Gupta Traders": -60000}  # + party owes shop, - shop owes party
    assert all(isinstance(v, int) for v in b.values())

    # A voided entry stops counting.
    assert client.post(f"/entries/{pay['id']}/void", headers=u["headers"]).status_code == 200
    assert _balances(client, u)["Ramesh"] == 50000

    # Detail endpoint agrees with the list (both read party_balances).
    ramesh = [p for p in client.get("/parties", headers=u["headers"]).json()["parties"]
              if p["display_name"] == "Ramesh"][0]
    detail = client.get(f"/parties/{ramesh['party_id']}", headers=u["headers"]).json()
    assert detail["balance_paise"] == 50000
    assert all(e["status"] != "voided" for e in detail["entries"])


def test_pending_entries_do_not_move_balances(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    _add(client, u, type="credit_given", amount_rupees=100, party_name="Ramesh")
    fake_sarvam.transcripts.append("Gave Ramesh 6000 on credit")
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Ramesh", "amount_rupees": 6000})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "confirm" and r["entry"]["status"] == "pending"
    assert _balances(client, u)["Ramesh"] == 10000  # unchanged until tapped
    client.post(f"/entries/{r['entry']['id']}/confirm", headers=u["headers"])
    assert _balances(client, u)["Ramesh"] == 610000


def test_edit_amount_type_party_moves_balance(client, users):
    u = users.with_shop()
    e = _add(client, u, type="credit_given", amount_rupees=300, party_name="Ramesh")
    _add(client, u, type="credit_given", amount_rupees=50, party_name="Suresh")
    assert _balances(client, u) == {"Ramesh": 30000, "Suresh": 5000}

    r = client.patch(f"/entries/{e['id']}", json={"amount_rupees": 450.25}, headers=u["headers"])
    assert r.status_code == 200 and r.json()["amount_paise"] == 45025
    assert _balances(client, u)["Ramesh"] == 45025

    r = client.patch(f"/entries/{e['id']}", json={"type": "payment_received"}, headers=u["headers"])
    assert r.status_code == 200, r.text
    assert _balances(client, u)["Ramesh"] == -45025

    suresh = [p for p in client.get("/parties", headers=u["headers"]).json()["parties"]
              if p["display_name"] == "Suresh"][0]["party_id"]
    r = client.patch(f"/entries/{e['id']}", json={"party_id": suresh}, headers=u["headers"])
    assert r.status_code == 200 and r.json()["party_name"] == "Suresh"
    assert _balances(client, u) == {"Ramesh": 0, "Suresh": 5000 - 45025}


def test_edit_type_to_other_kind_needs_a_party_of_that_kind(client, users):
    u = users.with_shop()
    e = _add(client, u, type="credit_given", amount_rupees=100, party_name="Ramesh")
    r = client.patch(f"/entries/{e['id']}", json={"type": "purchase_credit"}, headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "party_required"
    r = client.patch(f"/entries/{e['id']}", json={"type": "purchase_credit", "party_name": "Gupta"},
                     headers=u["headers"])
    assert r.status_code == 200 and r.json()["party_kind"] == "supplier"
    # To an expense: the party is dropped, the balance goes with it.
    r = client.patch(f"/entries/{e['id']}", json={"type": "expense"}, headers=u["headers"])
    assert r.status_code == 200 and r.json()["party_id"] is None
    assert _balances(client, u) == {"Ramesh": 0, "Gupta": 0}


def test_voided_entry_cannot_be_edited(client, users):
    u = users.with_shop()
    e = _add(client, u, type="cash_sale", amount_rupees=10)
    client.post(f"/entries/{e['id']}/void", headers=u["headers"])
    r = client.patch(f"/entries/{e['id']}", json={"amount_rupees": 20}, headers=u["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "voided"


@pytest.mark.parametrize("rupees, paise", [(0.10, 10), (1250.50, 125050), (5000, 500000), (5000.01, 500001)])
def test_api_boundary_rupees_in_paise_out(client, users, rupees, paise):
    u = users.with_shop()
    e = _add(client, u, type="cash_sale", amount_rupees=rupees)
    assert e["amount_paise"] == paise and isinstance(e["amount_paise"], int)


@pytest.mark.parametrize("bad", [0, -1, 10.005])
def test_api_rejects_bad_amounts(client, users, bad):
    u = users.with_shop()
    r = client.post("/entries", json={"type": "cash_sale", "amount_rupees": bad}, headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_amount"


# --- the ₹5,000 auto-save cap ------------------------------------------------------------------
@pytest.mark.parametrize("rupees, decision", [(5000, "auto"), (5000.01, "confirm")])
def test_auto_save_cap_voice(client, users, fake_sarvam, fake_groq, rupees, decision):
    u = users.with_shop()
    _add(client, u, type="credit_given", amount_rupees=1, party_name="Ramesh")
    fake_sarvam.transcripts.append(f"Ramesh took {rupees} on credit")
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Ramesh", "amount_rupees": rupees})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == decision
    assert r["entry"]["status"] == ("confirmed" if decision == "auto" else "pending")
    assert r["entry"]["amount_paise"] == round(rupees * 100)


def test_decide_save_cap_is_strictly_above_5000():
    def parsed(paise):
        return llm_router.ParsedEntry("cash_sale", None, paise, None, None, False, None)
    assert llm_router.decide_save(parsed(500000), []).action == "auto"
    assert llm_router.decide_save(parsed(500001), []).action == "confirm"
