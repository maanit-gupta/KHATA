"""GOAL_2.0 P1.2–P1.3, P1.6: does the pipeline hear what was actually said?

P1.2 (b) no response is cacheable; (d) every recording is stored under its own path with its own
bytes; (e) STT gets the speaker's own language, not the shop's; (f) the real container type reaches
Sarvam and the bytes are passed through untouched.
P1.3 every stage's raw output is kept on the voice note.
P1.6 silence / filler transcripts save nothing; auto-detect sends language_code "unknown".
"""

from __future__ import annotations

from pathlib import Path

from app.db import admin_client, user_client
from app.services import llm_router
from tests.conftest import AUDIO, post_audio

SAFARI_MP4 = (Path(__file__).resolve().parent / "fixtures" / "audio" / "safari_note.mp4").read_bytes()


def _note(u, note_id):
    return user_client(u["token"]).table("voice_notes").select("*").eq("id", note_id).execute().data[0]


def test_responses_are_never_cacheable(client, users):
    assert client.get("/health").headers["cache-control"] == "no-store"
    u = users.with_shop()
    assert client.get("/me", headers=u["headers"]).headers["cache-control"] == "no-store"
    assert client.get("/receipts/not-a-uuid", headers=u["headers"]).headers["cache-control"] == "no-store"


def test_each_recording_is_stored_separately_with_its_own_bytes(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    first = b"\x1aE\xdf\xa3" + b"\x01" * 3000
    second = b"\x1aE\xdf\xa3" + b"\x02" * 2500
    ids = []
    for data, words in ((first, "Paid one"), (second, "Paid two")):
        fake_sarvam.transcripts.append(words)
        fake_groq.parse_returns({"type": "cash_sale", "amount_rupees": 10})
        ids.append(post_audio(client, "/voice/entry", u["headers"], data=data).json()["voice_note_id"])
    notes = [_note(u, i) for i in ids]
    assert notes[0]["audio_path"] != notes[1]["audio_path"]
    stored = [admin_client().storage.from_("voice").download(n["audio_path"]) for n in notes]
    assert stored == [first, second]                    # what was uploaded is exactly what is kept
    assert fake_sarvam.audio == [first, second]         # ...and exactly what STT heard, in order


def test_stt_uses_the_speakers_language_not_the_shops(client, users, fake_sarvam, fake_groq):
    owner = users.with_shop(lang="hi-IN")
    staff = users.join(owner, lang="kn-IN")
    fake_sarvam.transcripts.append("Cash sale 40")
    fake_groq.parse_returns({"type": "cash_sale", "amount_rupees": 40})
    post_audio(client, "/voice/entry", staff["headers"])
    assert [c[1] for c in fake_sarvam.calls if c[0] == "stt"] == ["kn-IN"]


def test_auto_detect_sends_unknown_and_keeps_the_detected_language(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="ta-IN")
    assert client.patch("/me", json={"speech_auto": True}, headers=u["headers"]).json()["speech_auto"] is True
    fake_sarvam.transcripts.append("Cash sale 75")
    fake_groq.parse_returns({"type": "cash_sale", "amount_rupees": 75})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert [c[1] for c in fake_sarvam.calls if c[0] == "stt"] == ["unknown"]
    # The read-back is still spoken in the member's language.
    assert [c[3] for c in fake_sarvam.calls if c[0] == "translate"] == ["ta-IN"]
    assert r["decision"] == "auto"


def test_real_container_type_reaches_sarvam_even_when_mislabelled(client, users, fake_sarvam, fake_groq):
    """Safari can hand over an MP4 recording labelled audio/webm; the bytes decide (P1.2f)."""
    u = users.with_shop()
    fake_sarvam.transcripts.append("Cash sale 20")
    fake_groq.parse_returns({"type": "cash_sale", "amount_rupees": 20})
    r = client.post("/voice/entry", files={"audio": ("note.webm", SAFARI_MP4, "audio/webm")}, headers=u["headers"])
    assert r.status_code == 200, r.text
    stt = [c for c in fake_sarvam.calls if c[0] == "stt"][0]
    assert stt[2:] == ("audio/mp4", "note.mp4")
    assert fake_sarvam.audio == [SAFARI_MP4]            # passed through, never converted
    assert _note(u, r.json()["voice_note_id"])["audio_path"].endswith(".mp4")


def test_every_stage_is_recorded_on_the_voice_note(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="hi-IN")
    raw = "  Gave Ishaan Verma 340 on credit.  "
    fake_sarvam.transcripts.append(raw)
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Ishaan Verma", "amount_rupees": 340})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["stt_raw"] == raw and r["transcript_en"] == raw.strip()
    n = _note(u, r["voice_note_id"])
    assert n["stt_raw"] == raw                                   # exactly what Sarvam returned
    assert n["transcript_en"] == raw.strip()
    assert n["parsed"]["entry"]["party_name"] == "Ishaan Verma" and n["parsed"]["entry"]["amount_paise"] == 34000
    assert n["parsed"]["input_text"] == raw.strip()             # what the parser actually read
    assert n["decision"] == "auto"
    assert n["speech_text_en"] == "Ishaan Verma, 340 rupees udhaar, saved."
    assert n["speech_text_local"] == "[hi-IN] Ishaan Verma, 340 rupees udhaar, saved."
    assert r["speech_text_en"] == n["speech_text_en"] and r["speech_text"] == n["speech_text_local"]


def test_question_stages_are_recorded(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="ta-IN")
    fake_sarvam.transcripts.append(" Who owes me the most? ")
    fake_groq.script(fake_groq.text("Nobody owes you anything right now."))
    r = post_audio(client, "/voice/ask", u["headers"]).json()
    n = _note(u, r["voice_note_id"])
    assert n["stt_raw"] == " Who owes me the most? " and n["purpose"] == "question"
    assert n["speech_text_en"] == "Nobody owes you anything right now."
    assert n["speech_text_local"] == "[ta-IN] Nobody owes you anything right now." == r["text"]


def test_silence_and_filler_transcripts_save_nothing(client, users, fake_sarvam, fake_groq):
    u = users.with_shop()
    for said in ("", "   ", "...", "Thank you.", "Okay", "hmm"):
        fake_sarvam.transcripts.append(said)
        r = post_audio(client, "/voice/entry", u["headers"]).json()
        assert r["decision"] == "clarify" and r["entry"] is None, said
        assert r["speech_text"] == "I didn't catch that. Hold the button and say it again."
    assert fake_groq.calls == []                                # the parser never saw them
    assert client.get("/entries", headers=u["headers"]).json()["entries"] == []


def test_heard_nothing_is_narrow():
    assert llm_router.heard_nothing("") and llm_router.heard_nothing(" Thank you! ")
    for real in ("Paid Ramu 40", "fifty", "Thank you Ishaan for 20", "okay 300 udhaar Meera"):
        assert not llm_router.heard_nothing(real), real


def test_short_clip_is_refused_before_any_service_call(client, users, fake_sarvam):
    u = users.with_shop()
    r = post_audio(client, "/voice/entry", u["headers"], data=AUDIO[:500])
    assert r.status_code == 422 and r.json()["error"]["code"] == "empty_audio"
    assert fake_sarvam.calls == []


def test_expense_words_the_parser_calls_a_party_become_the_note(client, users, fake_sarvam, fake_groq):
    """Harness run 1, clip 6: "Paid 2470 for the electricity bill" came back with party_name
    "electricity bill". Expenses never take a party; the words are kept as the note."""
    u = users.with_shop()
    fake_sarvam.transcripts.append("Paid ₹2470 for the electricity bill.")
    fake_groq.parse_returns({"type": "expense", "party_name": "electricity bill", "amount_rupees": 2470})
    r = post_audio(client, "/voice/entry", u["headers"]).json()
    assert r["entry"]["party_id"] is None and r["entry"]["note"] == "electricity bill"
    assert client.get("/parties", headers=u["headers"]).json()["parties"] == []
