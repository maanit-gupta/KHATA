"""P1.7: every non-2xx is {"error": {"code", "message"}} in plain English; Sarvam and Groq retry
429/503 at 1 s / 2 s / 4 s and then fail with "Service busy" and nothing saved (CLAUDE.md §8)."""

from types import SimpleNamespace

import httpx
import pytest
from groq import APIConnectionError, InternalServerError, RateLimitError
from sarvamai.core.api_error import ApiError

from app.errors import AppError
from app.services import llm_router
from app.services.sarvam import Sarvam
from tests.conftest import post_audio


def _assert_error_shape(resp, status, code=None):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message"}
    assert body["error"]["message"] and body["error"]["message"][0].isupper()
    assert "sorry" not in body["error"]["message"].lower()
    if code:
        assert body["error"]["code"] == code


def test_error_shapes_without_a_shop(client, users):
    _assert_error_shape(client.get("/entries"), 401, "unauthorized")
    _assert_error_shape(client.get("/nope"), 404, "not_found")
    _assert_error_shape(client.delete("/health"), 405, "method_not_allowed")
    u = users.new()
    _assert_error_shape(client.get("/entries", headers=u["headers"]), 409, "no_shop")


def test_error_shapes_with_a_shop(client, users):
    u = users.with_shop()
    h = u["headers"]
    _assert_error_shape(client.post("/entries", json={"type": "nope", "amount_rupees": 1}, headers=h), 422, "invalid_request")
    _assert_error_shape(client.post("/entries", json={"type": "credit_given", "amount_rupees": 1}, headers=h), 422, "party_required")
    _assert_error_shape(client.get("/entries/not-a-uuid", headers=h), 404, "not_found")
    _assert_error_shape(client.get("/parties?kind=vendor", headers=h), 422, "bad_kind")
    _assert_error_shape(client.get("/entries?status=deleted", headers=h), 422, "bad_status")
    _assert_error_shape(client.post("/entries", json={"type": "cash_sale", "amount_rupees": 1, "occurred_on": "31/12/2026"},
                                    headers=h), 422, "bad_date")


# --- Sarvam backoff ----------------------------------------------------------------------------
def _sarvam_with(transcribe):
    s = Sarvam.__new__(Sarvam)
    s.client = SimpleNamespace(speech_to_text=SimpleNamespace(transcribe=transcribe))
    return s


@pytest.mark.parametrize("status", [429, 503])
def test_sarvam_retries_then_succeeds(fake_ai, status):
    calls = []

    def transcribe(**kw):
        calls.append(kw)
        if len(calls) < 3:
            raise ApiError(status_code=status, body={"error": {"message": "busy"}})
        return SimpleNamespace(transcript=" hello ")
    heard = _sarvam_with(transcribe).transcribe_to_english(b"x", "hi-IN")
    assert heard.raw == " hello " and heard.text == "hello"     # raw kept for stt_raw (GOAL_2.0 P1.3)
    assert len(calls) == 3 and fake_ai.sleeps == [1.0, 2.0]
    assert calls[0]["request_options"] == {"max_retries": 0}  # the SDK's own retries are off


@pytest.mark.parametrize("status", [429, 503])
def test_sarvam_gives_up_after_1_2_4(fake_ai, status):
    calls = []

    def transcribe(**kw):
        calls.append(kw)
        raise ApiError(status_code=status, body=None)
    with pytest.raises(AppError) as e:
        _sarvam_with(transcribe).transcribe_to_english(b"x", "hi-IN")
    assert (e.value.status, e.value.code, e.value.message) == (503, "service_busy", "Service busy, try again.")
    assert len(calls) == 4 and fake_ai.sleeps == [1.0, 2.0, 4.0]


def test_sarvam_other_errors_do_not_retry(fake_ai):
    def transcribe(**kw):
        raise ApiError(status_code=400, body=None)
    with pytest.raises(AppError) as e:
        _sarvam_with(transcribe).transcribe_to_english(b"x", "hi-IN")
    assert e.value.code == "speech_failed" and fake_ai.sleeps == []


# --- Groq backoff ------------------------------------------------------------------------------
def _groq_error(status):
    resp = httpx.Response(status, request=httpx.Request("POST", "https://api.groq.com/x"))
    cls = RateLimitError if status == 429 else InternalServerError
    return cls("busy", response=resp, body=None)


@pytest.mark.parametrize("status", [429, 503])
def test_groq_retries_then_gives_up(fake_ai, fake_groq, status):
    def handler(kwargs):
        raise _groq_error(status)
    fake_groq.handler = handler
    with pytest.raises(AppError) as e:
        llm_router.parse_entry("Ramesh 250 udhaar", "2026-09-26")
    assert e.value.code == "service_busy"
    assert len(fake_groq.calls) == 4 and fake_ai.sleeps == [1.0, 2.0, 4.0]


def test_groq_recovers_after_one_429(fake_ai, fake_groq):
    seen = []
    ok = fake_groq.text('{"type":"cash_sale","party_name":null,"amount_rupees":50,"note":null,'
                        '"occurred_on":null,"needs_clarification":false,"clarification_question":null}')

    def handler(kwargs):
        seen.append(1)
        if len(seen) == 1:
            raise _groq_error(429)
        return ok
    fake_groq.handler = handler
    assert llm_router.parse_entry("cash sale 50", "2026-09-26").amount_paise == 5000
    assert fake_ai.sleeps == [1.0]


def test_groq_connection_error_is_plain(fake_ai, fake_groq):
    def handler(kwargs):
        raise APIConnectionError(request=httpx.Request("POST", "https://api.groq.com/x"))
    fake_groq.handler = handler
    with pytest.raises(AppError) as e:
        llm_router.parse_entry("x", "2026-09-26")
    assert e.value.code == "reasoning_failed" and fake_ai.sleeps == []


# --- end to end: busy services save nothing ----------------------------------------------------
def _entry_count(client, u):
    return len(client.get("/entries", headers=u["headers"]).json()["entries"])


def test_voice_entry_groq_busy_saves_nothing(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    fake_sarvam.transcripts.append("Ramesh 250 udhaar")

    def handler(kwargs):
        raise _groq_error(429)
    fake_groq.handler = handler
    r = post_audio(client, "/voice/entry", u["headers"])
    _assert_error_shape(r, 503, "service_busy")
    assert _entry_count(client, u) == 0
    assert client.get("/parties", headers=u["headers"]).json()["parties"] == []


def test_voice_entry_stt_busy_saves_nothing(client, users, fake_sarvam):
    u = users.with_shop()
    fake_sarvam.fail["stt"] = AppError(503, "service_busy", "Service busy, try again.")
    r = post_audio(client, "/voice/entry", u["headers"])
    _assert_error_shape(r, 503, "service_busy")
    assert _entry_count(client, u) == 0
