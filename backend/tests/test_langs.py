"""GOAL_2.0 P5: a language per aspect. Unit tests for the fallbacks, then the mixed combination end to
end (Sarvam and Groq faked): speak Hindi, hear Tamil, read an English UI, get reports in Malayalam
(a third language, so a report that wrongly followed the voice language would show)."""

from __future__ import annotations

import pytest

from app import langs
from tests.conftest import post_audio
from tests.test_voice_ask import fake_groq_call


BASE = {"lang": "hi-IN", "tts_voice": None}


def test_everything_falls_back_to_the_spoken_language():
    m = {**BASE, "ui_lang": None, "voice_lang": None, "report_lang": None, "speech_auto": None}
    assert (langs.speech_lang(m), langs.voice_lang(m), langs.report_lang(m), langs.ui_lang(m)) == ("hi-IN",) * 4
    # Rows written before migration 003 have no such keys at all.
    assert (langs.voice_lang(BASE), langs.report_lang(BASE), langs.ui_lang(BASE)) == ("hi-IN",) * 3


def test_each_aspect_is_separate():
    m = {**BASE, "ui_lang": "en-IN", "voice_lang": "ta-IN", "report_lang": "ml-IN", "speech_auto": False}
    assert langs.speech_lang(m) == "hi-IN"
    assert langs.voice_lang(m) == "ta-IN"
    assert langs.report_lang(m) == "ml-IN"
    assert langs.ui_lang(m) == "en-IN"


def test_auto_detect_replaces_only_the_speech_language():
    m = {**BASE, "speech_auto": True, "voice_lang": None}
    assert langs.speech_lang(m) == "unknown"
    assert langs.voice_lang(m) == "hi-IN"       # read-backs still have a language to speak in


@pytest.mark.parametrize("m,lang,voice", [
    ({**BASE, "voice_lang": "ta-IN"}, None, "ratan"),          # default voice of the voice language
    ({**BASE}, None, "shubh"),                                 # of the spoken language when unset
    ({**BASE, "tts_voice": "priya", "voice_lang": "ta-IN"}, None, "priya"),   # a chosen voice wins
    ({**BASE}, "en-IN", "ratan"),                              # an explicit output language
])
def test_voice_for(m, lang, voice):
    assert langs.voice_for(m, lang) == voice


def _translate_targets(fake_sarvam):
    return [c[3] for c in fake_sarvam.calls if c[0] == "translate"]


def _tts(fake_sarvam):
    return [(c[2], c[3]) for c in fake_sarvam.calls if c[0] == "tts"]


def test_mixed_languages_end_to_end(client, users, fake_sarvam, fake_groq):
    u = users.with_shop(lang="hi-IN")
    h = u["headers"]
    r = client.patch("/me", json={"ui_lang": "en-IN", "voice_lang": "ta-IN", "report_lang": "ml-IN"}, headers=h)
    assert r.status_code == 200, r.text
    me = client.get("/me", headers=h).json()["membership"]
    assert (me["lang"], me["ui_lang"], me["voice_lang"], me["report_lang"]) == ("hi-IN", "en-IN", "ta-IN", "ml-IN")

    # Voice entry: heard as Hindi, read back in Tamil with the Tamil default voice.
    fake_sarvam.transcripts.append("Gave Ramesh 250 on credit")
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Ramesh", "amount_rupees": 250})
    r = post_audio(client, "/voice/entry", h).json()
    assert r["decision"] == "auto"
    assert [c[1] for c in fake_sarvam.calls if c[0] == "stt"] == ["hi-IN"]
    assert _translate_targets(fake_sarvam) == ["ta-IN"]
    assert r["speech_text"].startswith("[ta-IN] ")
    assert _tts(fake_sarvam) == [("ta-IN", "ratan")]

    # A question: same split.
    fake_sarvam.calls.clear()
    fake_sarvam.transcripts.append("How much does Ramesh owe?")
    state = {"n": 0}

    def handler(kwargs):
        state["n"] += 1
        if state["n"] == 1:
            return fake_groq.tools(fake_groq_call("find_party", {"name": "Ramesh"}))
        return fake_groq.text("Ramesh owes you 250 rupees.")
    fake_groq.handler = handler
    r = post_audio(client, "/voice/ask", h)
    assert r.status_code == 200, r.text
    assert [c[1] for c in fake_sarvam.calls if c[0] == "stt"] == ["hi-IN"]
    assert _translate_targets(fake_sarvam) == ["ta-IN"] and _tts(fake_sarvam) == [("ta-IN", "ratan")]

    # The weekly summary is written in the report language, not the voice language.
    fake_sarvam.calls.clear()
    fake_groq.script(fake_groq.text("So far this week you gave 250 rupees on credit."))
    body = client.get("/insights/weekly", headers=h).json()
    assert body["narration"] == "[ml-IN] " + body["narration_en"]

    # Playing it: purpose "report" speaks Malayalam; a read-back sample speaks Tamil.
    fake_sarvam.calls.clear()
    r = client.post("/tts", json={"text": body["narration_en"], "purpose": "report"}, headers=h).json()
    assert r["text"].startswith("[ml-IN] ") and _tts(fake_sarvam)[-1][0] == "ml-IN"
    r = client.post("/tts", json={"text": "Ramesh owes you 250 rupees."}, headers=h).json()
    assert r["text"].startswith("[ta-IN] ") and _tts(fake_sarvam)[-1] == ("ta-IN", "ratan")


def test_clearing_an_aspect_falls_back_again(client, users):
    u = users.with_shop(lang="kn-IN")
    h = u["headers"]
    client.patch("/me", json={"voice_lang": "ta-IN"}, headers=h)
    r = client.patch("/me", json={"voice_lang": None}, headers=h)
    assert r.status_code == 200 and r.json()["voice_lang"] is None
    assert client.patch("/me", json={"report_lang": "xx-IN"}, headers=h).status_code == 422
