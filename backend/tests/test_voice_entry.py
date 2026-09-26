"""P3: voice entry to spec. §12 acceptance scenarios 1–4, the "Did you mean" resolve (both
choices), the clarify answer-join (§9b), recording formats (Safari MP4), and that every read-back
or question is composed in English then localized with the number guard (P3.4)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.routers.voice import spoken_rupees
from tests.conftest import AUDIO, post_audio

SAFARI_MP4 = (Path(__file__).resolve().parent / "fixtures" / "audio" / "safari_note.mp4").read_bytes()


def _party(client, u, name, kind="customer", rupees=1):
    t = "credit_given" if kind == "customer" else "purchase_credit"
    client.post("/entries", json={"type": t, "amount_rupees": rupees, "party_name": name}, headers=u["headers"])


def _balances(client, u):
    return {p["display_name"]: p["balance_paise"] for p in client.get("/parties", headers=u["headers"]).json()["parties"]}


def _say(fake_sarvam, fake_groq, transcript, **parsed):
    fake_sarvam.transcripts.append(transcript)
    fake_groq.parse_returns(parsed)


def _translations(fake_sarvam):
    return [(c[1], c[3]) for c in fake_sarvam.calls if c[0] == "translate"]


# --- §12 acceptance --------------------------------------------------------------------------
def test_12_1_existing_party_auto_saves_and_reads_back(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="hi-IN")
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "Gave Ramesh 250 on credit", type="credit_given", party_name="Ramesh", amount_rupees=250)
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "auto" and r["entry"]["status"] == "confirmed" and r["entry"]["auto_saved"] is True
    assert _balances(client, u)["Ramesh"] == 100 + 25000
    # Composed in English, then translated to the user's language (P3.4, §9b).
    assert _translations(fake_sarvam) == [("Ramesh, 250 rupees udhaar, saved.", "hi-IN")]
    assert r["speech_text"] == "[hi-IN] Ramesh, 250 rupees udhaar, saved."
    assert r["audio_b64"] and fake_sarvam.calls[-1][:3] == ("tts", r["speech_text"], "hi-IN")
    # Undo = void (the UI's 5 s toast calls this).
    client.post(f"/entries/{r['entry']['id']}/void", headers=u["headers"])
    assert _balances(client, u)["Ramesh"] == 100


def test_12_2_big_amount_waits_for_a_tap(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "Ramesh 6000 udhaar", type="credit_given", party_name="Ramesh", amount_rupees=6000)
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "confirm" and r["entry"]["status"] == "pending"
    assert r["entry"]["review_reason"] == "amount above ₹5,000"
    assert r["speech_text"] == "Ramesh, 6,000 rupees udhaar. Tap confirm to save."   # en-IN: no translate
    assert _balances(client, u)["Ramesh"] == 100


def test_12_3_close_name_asks_did_you_mean_without_creating_a_party(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "Rakesh 250 udhaar", type="credit_given", party_name="Rakesh", amount_rupees=250)
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "confirm" and r["suggestion"] == "Ramesh"
    assert r["speech_text"] == "Rakesh, 250 rupees udhaar. Did you mean Ramesh?"
    assert r["entry"]["status"] == "pending" and r["entry"]["party_name"] == "Ramesh"
    assert list(_balances(client, u)) == ["Ramesh"]          # no new party
    assert _balances(client, u)["Ramesh"] == 100              # nothing counted yet


def test_12_4_brand_new_name_is_created_flagged_and_auto_saved(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    _say(fake_sarvam, fake_groq, "Mahalakshmi 300 udhaar", type="credit_given", party_name="Mahalakshmi",
         amount_rupees=300)
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "auto"
    party = client.get("/parties", headers=u["headers"]).json()["parties"][0]
    assert party["display_name"] == "Mahalakshmi" and party["needs_review"] is True
    assert party["balance_paise"] == 30000
    review = client.get("/review", headers=u["headers"]).json()["rows"]
    assert [(x["item"], x["id"]) for x in review] == [("party", party["party_id"])]


# --- P3.1 resolve ------------------------------------------------------------------------------
def _did_you_mean(client, u, fake_sarvam, fake_groq, rupees=250):
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "Rakesh udhaar", type="credit_given", party_name="Rakesh", amount_rupees=rupees)
    return post_audio(client, "/voice/entry", u["headers"]).json()


def test_resolve_use_suggested(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    first = _did_you_mean(client, u, fake_sarvam, fake_groq)
    r = client.post("/voice/entry/resolve", json={"voice_note_id": first["voice_note_id"], "choice": "use_suggested"},
                    headers=u["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= {"decision", "entry", "suggestion", "speech_text", "audio_b64", "voice_note_id"}
    assert body["decision"] == "auto" and body["entry"]["id"] == first["entry"]["id"]
    assert body["entry"]["status"] == "confirmed" and body["entry"]["auto_saved"] is True
    assert body["speech_text"] == "Ramesh, 250 rupees udhaar, saved."
    assert _balances(client, u) == {"Ramesh": 25100}
    again = client.post("/voice/entry/resolve", json={"voice_note_id": first["voice_note_id"], "choice": "create_new"},
                        headers=u["headers"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_resolved"


def test_resolve_create_new(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    first = _did_you_mean(client, u, fake_sarvam, fake_groq)
    body = client.post("/voice/entry/resolve", json={"voice_note_id": first["voice_note_id"], "choice": "create_new"},
                       headers=u["headers"]).json()
    assert body["decision"] == "auto" and body["entry"]["party_name"] == "Rakesh"
    assert _balances(client, u) == {"Ramesh": 100, "Rakesh": 25000}
    rakesh = [p for p in client.get("/parties", headers=u["headers"]).json()["parties"] if p["display_name"] == "Rakesh"][0]
    assert rakesh["needs_review"] is True


def test_resolve_keeps_the_amount_rule(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    first = _did_you_mean(client, u, fake_sarvam, fake_groq, rupees=7000)
    body = client.post("/voice/entry/resolve", json={"voice_note_id": first["voice_note_id"], "choice": "create_new"},
                       headers=u["headers"]).json()
    assert body["decision"] == "confirm" and body["entry"]["status"] == "pending"
    assert body["entry"]["review_reason"] == "amount above ₹5,000" and body["entry"]["party_name"] == "Rakesh"
    assert _balances(client, u)["Rakesh"] == 0


def test_resolve_needs_a_did_you_mean_note(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    _say(fake_sarvam, fake_groq, "cash sale 50", type="cash_sale", amount_rupees=50)
    note = post_audio(client, "/voice/entry", u["headers"]).json()["voice_note_id"]
    r = client.post("/voice/entry/resolve", json={"voice_note_id": note, "choice": "use_suggested"}, headers=u["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "nothing_to_resolve"
    r = client.post("/voice/entry/resolve", json={"voice_note_id": "nope", "choice": "use_suggested"}, headers=u["headers"])
    assert r.status_code == 404


# --- P3.2 clarify join -------------------------------------------------------------------------
def test_clarify_saves_nothing_then_answer_is_joined(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="ta-IN")
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "Ramesh took some on credit", type="credit_given", party_name="Ramesh",
         amount_rupees=None, needs_clarification=True, clarification_question="How much did Ramesh take?")
    q = post_audio(client, "/voice/entry", u["headers"]).json()
    assert q["decision"] == "clarify" and q["entry"] is None
    assert q["speech_text"] == "[ta-IN] How much did Ramesh take?"          # English → localized
    assert _translations(fake_sarvam) == [("How much did Ramesh take?", "ta-IN")]
    assert _balances(client, u)["Ramesh"] == 100                             # nothing saved

    _say(fake_sarvam, fake_groq, "two hundred fifty", type="credit_given", party_name="Ramesh", amount_rupees=250)
    r = client.post("/voice/entry", files={"audio": ("note.webm", AUDIO, "audio/webm")},
                    data={"answer_to": q["voice_note_id"]}, headers=u["headers"]).json()
    parse_input = fake_groq.calls[-1]["messages"][1]["content"]
    assert parse_input == "Ramesh took some on credit two hundred fifty"     # first + " " + answer
    assert r["decision"] == "auto" and _balances(client, u)["Ramesh"] == 25100
    # The question can't be answered twice.
    again = client.post("/voice/entry", files={"audio": ("note.webm", AUDIO, "audio/webm")},
                        data={"answer_to": r["voice_note_id"]}, headers=u["headers"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_answered"


def test_clarify_chain_carries_all_answers(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    ask = dict(type="credit_given", party_name=None, amount_rupees=None, needs_clarification=True,
               clarification_question="Who and how much?")
    _say(fake_sarvam, fake_groq, "gave udhaar", **ask)
    q1 = post_audio(client, "/voice/entry", u["headers"]).json()
    _say(fake_sarvam, fake_groq, "to Suresh", **ask)
    q2 = client.post("/voice/entry", files={"audio": ("n.webm", AUDIO, "audio/webm")},
                     data={"answer_to": q1["voice_note_id"]}, headers=u["headers"]).json()
    assert q2["decision"] == "clarify"
    _say(fake_sarvam, fake_groq, "80 rupees", type="credit_given", party_name="Suresh", amount_rupees=80)
    client.post("/voice/entry", files={"audio": ("n.webm", AUDIO, "audio/webm")},
                data={"answer_to": q2["voice_note_id"]}, headers=u["headers"])
    assert fake_groq.calls[-1]["messages"][1]["content"] == "gave udhaar to Suresh 80 rupees"


def test_silence_is_a_clarify_without_calling_groq(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    fake_sarvam.transcripts.append("")
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["decision"] == "clarify" and r["speech_text"] == "I didn't catch that. Hold the button and say it again."
    assert fake_groq.calls == []


# --- P3.3 recording formats and limits ---------------------------------------------------------
@pytest.mark.parametrize("mime", ["audio/mp4", "audio/mp4;codecs=mp4a.40.2", "application/octet-stream"])
def test_safari_mp4_is_accepted(client, users, fake_sarvam, fake_groq, mime):
    u = users.with_shop()
    _say(fake_sarvam, fake_groq, "cash sale 20", type="cash_sale", amount_rupees=20)
    r = client.post("/voice/entry", files={"audio": ("note.mp4", SAFARI_MP4, mime)}, headers=u["headers"])
    assert r.status_code == 200, r.text
    stt = [c for c in fake_sarvam.calls if c[0] == "stt"][0]
    assert stt[2] == "audio/mp4" and stt[3] == "note.mp4"                 # sent as-is (§6.1)
    from app.db import user_client
    note = user_client(u["token"]).table("voice_notes").select("audio_path").eq("id", r.json()["voice_note_id"]).execute().data[0]
    assert note["audio_path"].startswith(f"{u['shop_id']}/") and note["audio_path"].endswith(".mp4")


def test_recording_limits(client, users, fake_sarvam):
    u = users.with_shop()
    r = post_audio(client, "/voice/entry", u["headers"], data=b"\x1aE\xdf\xa3" + b"\x00" * 100)
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_audio"
    assert r.json()["error"]["message"] == "Hold the button while speaking."
    r = post_audio(client, "/voice/entry", u["headers"], mime="video/quicktime")
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_audio"
    r = post_audio(client, "/voice/entry", u["headers"], data=b"\x1aE\xdf\xa3" + b"\x00" * (10 * 1024 * 1024))
    assert r.status_code == 413
    assert fake_sarvam.calls == []


# --- P3.4 number guard on read-backs -------------------------------------------------------------
def test_translation_that_changes_a_number_falls_back_to_english(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="te-IN")
    fake_sarvam.translate_fn = lambda text, tgt: text.replace("250", "25")   # a bad translation
    _say(fake_sarvam, fake_groq, "cash sale 250", type="cash_sale", amount_rupees=250)
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["speech_text"] == "250 rupees cash sale, saved."
    assert fake_sarvam.calls[-1][:3] == ("tts", "250 rupees cash sale, saved.", "te-IN")


def test_tts_failure_never_undoes_a_save(client, users, fake_sarvam, fake_groq):
    from app.errors import AppError
    u = users.with_shop()
    fake_sarvam.fail["tts"] = AppError(503, "service_busy", "Service busy, try again.")
    _say(fake_sarvam, fake_groq, "cash sale 40", type="cash_sale", amount_rupees=40)
    r = post_audio(client, "/voice/entry", u["headers"])
    assert r.status_code == 200 and r.json()["audio_b64"] is None and r.json()["entry"]["status"] == "confirmed"


@pytest.mark.parametrize("paise, text", [(25000, "250"), (600000, "6,000"), (12500000, "1,25,000"),
                                         (25050, "250.50"), (100, "1"), (10000000, "1,00,000")])
def test_spoken_rupees(paise, text):
    assert spoken_rupees(paise) == text


def test_a_note_that_just_repeats_the_transcript_is_dropped(client, users, fake_sarvam, fake_groq):
    """Seen live (tests/fixtures/live/voice_*.json): the parser put the whole sentence in `note`."""
    u = users.with_shop()
    _say(fake_sarvam, fake_groq, "Ramesh was given ₹250 as a loan.", type="credit_given", party_name="Ramesh",
         amount_rupees=250, note="Ramesh was given ₹250 as a loan.")
    assert post_audio(client, "/voice/entry", u["headers"]).json()["entry"]["note"] is None
    _say(fake_sarvam, fake_groq, "Ramesh 250 udhaar for rice", type="credit_given", party_name="Ramesh",
         amount_rupees=250, note="for rice")
    assert post_audio(client, "/voice/entry", u["headers"]).json()["entry"]["note"] == "for rice"


# --- stretch: STT priming with party names (flag off by default, D-045) ------------------------
def test_stt_priming_is_off_by_default(client, users, fake_sarvam, fake_groq, monkeypatch):
    monkeypatch.delenv("STT_PRIME_PARTY_NAMES", raising=False)
    u = users.with_shop()
    _party(client, u, "Ramesh")
    _say(fake_sarvam, fake_groq, "cash sale 5", type="cash_sale", amount_rupees=5)
    post_audio(client, "/voice/entry", u["headers"])
    assert fake_sarvam.keyterms == [None]


def test_stt_priming_sends_party_names_when_on(client, users, fake_sarvam, fake_groq, monkeypatch):
    monkeypatch.setenv("STT_PRIME_PARTY_NAMES", "1")
    u = users.with_shop()
    _party(client, u, "Ramesh")
    _party(client, u, "Gupta Traders", kind="supplier")
    _say(fake_sarvam, fake_groq, "cash sale 5", type="cash_sale", amount_rupees=5)
    post_audio(client, "/voice/entry", u["headers"])
    assert sorted(fake_sarvam.keyterms[0]) == ["Gupta Traders", "Ramesh"]


def test_sarvam_adapter_uses_v4_only_with_keyterms():
    from types import SimpleNamespace
    from app.services.sarvam import Sarvam
    seen = []
    s = Sarvam.__new__(Sarvam)
    s.client = SimpleNamespace(speech_to_text=SimpleNamespace(
        transcribe=lambda **kw: seen.append(kw) or SimpleNamespace(transcript="x")))
    s.transcribe_to_english(b"a", "hi-IN")
    s.transcribe_to_english(b"a", "hi-IN", keyterms=["Ramesh"] * 60)
    assert seen[0]["model"] == "saaras:v3" and "keyterms" not in seen[0] and seen[0]["mode"] == "translate"
    assert seen[1]["model"] == "saaras:v4" and len(seen[1]["keyterms"]) == 50 and seen[1]["mode"] == "translate"
