"""P2: receipt OCR (background, 2 s polling, 90 s timeout, English retry, digitise+Groq fallback
with the number guard) and saving a bill (save rules, idempotent, review queue). Sarvam and Groq
are fakes shaped like the real responses saved in tests/fixtures/live/."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pytest

from app.db import user_client
from app.errors import AppError
from app.ledger import now_ist
from app.services import llm_router, receipt_ocr

FIXTURES = Path(__file__).resolve().parent / "fixtures"
PNG = (FIXTURES / "receipts" / "printed_bill.png").read_bytes()


def live_results() -> dict:
    """The real get_results payload from diagnosis run 1 (hi-IN, printed bill)."""
    path = sorted((FIXTURES / "live").glob("receipt_*_hi-IN.json"))[0]
    log = json.loads(path.read_text())["log"]
    return next(e["response"] for e in log if e["call"] == "get_results")


def extract_job(result: dict | None = None, statuses=("pending", "pending", "completed")) -> dict:
    base = live_results()
    if result is not None:
        base = {**base, "result": result}
    return {"statuses": list(statuses), "results": base}


def digitise_job(text: str) -> dict:
    return {"statuses": ["pending", "completed"],
            "results": {"type": "digitise", "status": "completed",
                        "documents": [{"file_name": "bill.png", "pages": [{"page_number": 1, "content": text}]}]}}


FAILED = {"statuses": ["pending", "failed"], "results": {}}
EMPTY = {"vendor_name": None, "bill_date": None, "total": None}


def read(fake_sarvam, lang="hi-IN", groq=None):
    return receipt_ocr.read_receipt(fake_sarvam, PNG, "bill.png", "image/png", lang,
                                    fields_from_text=groq or llm_router.receipt_fields)


# --- pure helpers ----------------------------------------------------------------------------
@pytest.mark.parametrize("raw, paise", [(3600.0, 360000), (3600, 360000), ("3,600.00", 360000),
                                        ("Rs 3,600.00", 360000), ("₹ 1,25,000/-", 12500000),
                                        ("99.5", 9950), (None, None), ("", None), ("abc", None), (0, None)])
def test_parse_total(raw, paise):
    assert receipt_ocr.parse_total_paise(raw) == paise


@pytest.mark.parametrize("raw, iso", [("24/09/2026", "2026-09-24"), ("24-09-26", "2026-09-24"),
                                      ("2026-09-24", "2026-09-24"), ("24 Sep 2026", "2026-09-24"),
                                      ("Sep 24, 2026", "2026-09-24"), ("tomorrow", None), (None, None)])
def test_parse_date(raw, iso):
    assert receipt_ocr.parse_date(raw) == iso


def test_number_guard():
    text = "GRAND TOTAL   Rs 3,600.00\nCGST 85.75"
    assert receipt_ocr.total_in_text(360000, text)
    assert receipt_ocr.total_in_text(8575, text)
    assert not receipt_ocr.total_in_text(343000, text)      # a sum the bill never prints
    assert not receipt_ocr.total_in_text(36000, text)       # 360 is not 3600
    assert receipt_ocr.total_in_text(360000, "Total 3600")


# --- read_receipt lifecycle --------------------------------------------------------------------
def test_success_first_try(fake_sarvam, fake_ai):
    fake_sarvam.doc_jobs = [extract_job()]
    o = read(fake_sarvam)
    assert (o.status, o.vendor_name, o.bill_date, o.total_paise) == ("done", "SHREE BALAJI TRADERS", "2026-09-24", 360000)
    assert not o.retried_in_english and not o.used_fallback
    assert fake_sarvam.count("doc_extract") == 1
    assert fake_ai.clock.polls == [2.0, 2.0, 2.0]           # polls every 2 s
    assert o.raw["attempts"][0]["results"]["result"]["total"] == 3600.0   # raw kept for raw_extract


def test_first_try_fails_then_english_succeeds(fake_sarvam):
    fake_sarvam.doc_jobs = [FAILED, extract_job()]
    o = read(fake_sarvam, lang="ta-IN")
    assert o.status == "done" and o.retried_in_english and o.total_paise == 360000
    assert [c[1] for c in fake_sarvam.calls if c[0] == "doc_extract"] == ["ta-IN", "en-IN"]


def test_empty_date_triggers_english_retry(fake_sarvam):
    fake_sarvam.doc_jobs = [extract_job({"vendor_name": "Balaji", "bill_date": "", "total": 250}),
                            extract_job({"vendor_name": "BALAJI", "bill_date": "24/09/2026", "total": 250})]
    o = read(fake_sarvam)
    assert o.retried_in_english
    assert (o.vendor_name, o.bill_date, o.total_paise) == ("Balaji", "2026-09-24", 25000)


def test_no_retry_when_fields_present_or_already_english(fake_sarvam):
    fake_sarvam.doc_jobs = [extract_job({"vendor_name": None, "bill_date": "1/1/2026", "total": 5})]
    assert not read(fake_sarvam).retried_in_english         # vendor missing alone: no retry (§6.3.5)
    fake_sarvam.doc_jobs = [FAILED, digitise_job("")]
    o = read(fake_sarvam, lang="en-IN")
    assert not o.retried_in_english  # an en-IN user gets no duplicate English job
    assert fake_sarvam.count("doc_extract") == 2 and fake_sarvam.count("doc_digitise") == 1


def test_double_failure_then_fallback_fails_too(fake_sarvam, fake_groq):
    fake_sarvam.doc_jobs = [FAILED, FAILED, {"start_error": AppError(502, "ocr_failed", "x")}]
    o = read(fake_sarvam)
    assert o.status == "failed" and o.retried_in_english and o.used_fallback
    assert o.error == "Couldn't read that bill. Type the values below."
    assert o.total_paise is None and fake_groq.calls == []


def test_fallback_reads_text_with_groq_and_guard_passes(fake_sarvam, fake_groq):
    fake_sarvam.doc_jobs = [extract_job(EMPTY), extract_job(EMPTY),
                            digitise_job("SHREE BALAJI TRADERS\nDate: 24/09/2026\nGRAND TOTAL Rs 3,600.00")]
    fake_groq.script(fake_groq.text(json.dumps({"vendor_name": "SHREE BALAJI TRADERS",
                                                "bill_date": "24/09/2026", "total": 3600})))
    o = read(fake_sarvam)
    assert (o.status, o.total_paise, o.bill_date) == ("done", 360000, "2026-09-24") and o.used_fallback
    call = fake_groq.calls[0]
    assert call["model"] == llm_router.PARSE_MODEL and call["response_format"]["json_schema"]["strict"] is True


def test_fallback_total_not_in_text_is_left_empty(fake_sarvam, fake_groq):
    fake_sarvam.doc_jobs = [extract_job(EMPTY), extract_job(EMPTY),
                            digitise_job("BALAJI\n24/09/2026\nRice 1,150.00\nDal 640.00")]
    fake_groq.script(fake_groq.text(json.dumps({"vendor_name": "BALAJI", "bill_date": "24/09/2026",
                                                "total": 1790})))  # the model added it up: not printed
    o = read(fake_sarvam)
    assert o.total_paise is None and o.status == "failed"
    assert o.error == "Couldn't read the total. Type the values below."
    assert o.vendor_name == "BALAJI" and o.bill_date == "2026-09-24"     # still pre-filled
    assert o.raw["attempts"][-1]["guard"] == {"total_paise": 179000, "found_in_text": False}


def test_timeout_after_90s(fake_sarvam, fake_ai):
    fake_sarvam.doc_jobs = [{"statuses": ["pending"], "results": {}}, {"statuses": ["running"], "results": {}},
                            {"statuses": ["pending"], "results": {}}]
    o = read(fake_sarvam)
    assert o.status == "failed"
    assert fake_sarvam.count("doc_status") == 3 * 45              # 90 s / 2 s per job
    assert "timed out" in o.raw["attempts"][0]["error"]


def test_busy_service_is_reported(fake_sarvam):
    busy = AppError(503, "service_busy", "Service busy, try again.")
    fake_sarvam.doc_jobs = [{"start_error": busy}, {"start_error": busy}, {"start_error": busy}]
    o = read(fake_sarvam)
    assert o.status == "failed" and o.error.startswith("Service busy, try again.")


# --- API ------------------------------------------------------------------------------------
def _upload(client, u, kind="supplier", settled="false", data=PNG, mime="image/png"):
    form = {"kind": kind} if settled is None else {"kind": kind, "settled": settled}
    return client.post("/receipts", files={"image": ("bill.png", data, mime)}, data=form, headers=u["headers"])


def test_upload_returns_id_then_background_fills_fields(client, users, fake_sarvam):
    u = users.with_shop(lang="hi-IN")
    fake_sarvam.doc_jobs = [extract_job()]
    r = _upload(client, u)
    assert r.status_code == 201 and set(r.json()) == {"receipt_id", "status"}
    assert r.json()["status"] == "queued"
    # TestClient runs BackgroundTasks after the response; the poll now sees the result.
    got = client.get(f"/receipts/{r.json()['receipt_id']}", headers=u["headers"]).json()
    assert got["status"] == "done"
    assert (got["vendor_name"], got["bill_date"], got["total_paise"]) == ("SHREE BALAJI TRADERS", "2026-09-24", 360000)
    row = user_client(u["token"]).table("receipts").select("*").eq("id", got["receipt_id"]).execute().data[0]
    assert row["raw_extract"]["attempts"][0]["results"]["result"]["total"] == 3600.0
    assert row["sarvam_job_id"] == "job-1" and row["ocr_lang_first"] == "hi-IN"
    assert row["image_path"].startswith(f"{u['shop_id']}/")


def test_upload_validation(client, users, fake_sarvam):
    u = users.with_shop()
    assert _upload(client, u, settled=None).json()["error"]["code"] == "settled_required"
    r = _upload(client, u, data=b"GIF89a", mime="image/gif")
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_image"
    r = _upload(client, u, data=b"\x89PNG" + b"0" * (10 * 1024 * 1024), mime="image/png")
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
    assert fake_sarvam.calls == []


def test_supplier_credit_scan_edit_total_and_save(client, users, fake_sarvam):
    """§12: supplier bill, Credit → purchase_credit against that supplier; editing the total works."""
    u = users.with_shop()
    fake_sarvam.doc_jobs = [extract_job()]
    rid = _upload(client, u).json()["receipt_id"]
    r = client.post(f"/receipts/{rid}/save", json={"vendor_name": "Shree Balaji Traders", "bill_date": "2026-09-24",
                                                   "total_rupees": 3450.50}, headers=u["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    e = body["entry"]
    assert body["decision"] == "auto" and e["type"] == "purchase_credit" and e["amount_paise"] == 345050
    assert e["party_name"] == "Shree Balaji Traders" and e["party_kind"] == "supplier"
    assert e["occurred_on"] == "2026-09-24" and e["receipt_id"] == rid and e["source"] == "receipt"
    bal = client.get(f"/parties/{e['party_id']}", headers=u["headers"]).json()
    assert bal["balance_paise"] == -345050 and bal["party"]["needs_review"] is True   # new supplier flagged
    # Saving the same bill again is refused.
    again = client.post(f"/receipts/{rid}/save", json={"vendor_name": "X", "total_rupees": 1}, headers=u["headers"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_saved"
    # After Undo (void), the bill can be saved again.
    client.post(f"/entries/{e['id']}/void", headers=u["headers"])
    ok = client.post(f"/receipts/{rid}/save", json={"vendor_name": "Shree Balaji Traders", "total_rupees": 3450.50},
                     headers=u["headers"])
    assert ok.status_code == 200


@pytest.mark.parametrize("kind, settled, etype", [("supplier", "true", "purchase_paid"),
                                                  ("customer", "true", "cash_sale"),
                                                  ("expense", None, "expense")])
def test_kind_mapping(client, users, fake_sarvam, kind, settled, etype):
    u = users.with_shop()
    fake_sarvam.doc_jobs = [extract_job()]
    rid = _upload(client, u, kind=kind, settled=settled).json()["receipt_id"]
    e = client.post(f"/receipts/{rid}/save", json={"vendor_name": "Balaji", "total_rupees": 100},
                    headers=u["headers"]).json()["entry"]
    assert e["type"] == etype
    if etype == "purchase_paid":
        assert e["party_name"] == "Balaji" and e["party_kind"] == "supplier"   # §9b: linked
    else:
        assert e["party_id"] is None and e["note"] == "Balaji"                # §9b: vendor → note


def test_customer_udhaar_asks_for_name(client, users, fake_sarvam):
    u = users.with_shop()
    fake_sarvam.doc_jobs = [extract_job()]
    rid = _upload(client, u, kind="customer", settled="false").json()["receipt_id"]
    r = client.post(f"/receipts/{rid}/save", json={"vendor_name": "My Shop", "total_rupees": 100}, headers=u["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "party_required"
    r = client.post(f"/receipts/{rid}/save", json={"vendor_name": "My Shop", "total_rupees": 100,
                                                   "customer_name": "Ramesh"}, headers=u["headers"])
    assert r.json()["entry"]["type"] == "credit_given" and r.json()["entry"]["party_name"] == "Ramesh"


def test_big_bill_waits_for_a_tap(client, users, fake_sarvam):
    u = users.with_shop()
    fake_sarvam.doc_jobs = [extract_job()]
    rid = _upload(client, u, kind="expense", settled=None).json()["receipt_id"]
    r = client.post(f"/receipts/{rid}/save", json={"vendor_name": "Landlord", "total_rupees": 5000.01},
                    headers=u["headers"]).json()
    assert r["decision"] == "confirm" and r["entry"]["status"] == "pending"


def test_failed_bill_goes_to_review_then_leaves_when_saved(client, users, fake_sarvam):
    u = users.with_shop(lang="kn-IN")
    fake_sarvam.doc_jobs = [FAILED, FAILED, FAILED]
    rid = _upload(client, u, kind="expense", settled=None).json()["receipt_id"]
    got = client.get(f"/receipts/{rid}", headers=u["headers"]).json()
    assert got["status"] == "failed" and got["retried_in_english"] is True and got["total_paise"] is None
    review = client.get("/review", headers=u["headers"]).json()
    assert [(r["item"], r["id"]) for r in review["rows"]] == [("receipt", rid)]
    client.post(f"/receipts/{rid}/save", json={"vendor_name": "Power bill", "total_rupees": 812}, headers=u["headers"])
    assert client.get("/review", headers=u["headers"]).json()["count"] == 0


def test_save_while_reading_is_refused_and_stale_jobs_fail(client, users):
    u = users.with_shop()
    db = user_client(u["token"])
    fresh = db.table("receipts").insert({"shop_id": u["shop_id"], "image_path": f"{u['shop_id']}/x.png",
                                         "kind": "expense", "ocr_lang_first": "en-IN", "status": "processing"}
                                        ).execute().data[0]
    r = client.post(f"/receipts/{fresh['id']}/save", json={"total_rupees": 5}, headers=u["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "still_reading"
    old = (now_ist() - timedelta(minutes=10)).isoformat()
    stale = db.table("receipts").insert({"shop_id": u["shop_id"], "image_path": f"{u['shop_id']}/y.png",
                                         "kind": "expense", "ocr_lang_first": "en-IN", "status": "processing",
                                         "created_at": old}).execute().data[0]
    got = client.get(f"/receipts/{stale['id']}", headers=u["headers"]).json()
    assert got["status"] == "failed" and got["error"] == "Reading the bill stopped. Type the values below."
