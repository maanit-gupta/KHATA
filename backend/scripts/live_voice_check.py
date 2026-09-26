"""LIVE check of the voice paths with real Sarvam and Groq (spends credits: about 6 Sarvam calls and
3–5 Groq calls). A throwaway user + shop (hi-IN) is created and deleted.

1. POST /voice/entry with tests/fixtures/audio/safari_note.mp4 ("Ramesh ko do sau pachaas udhaar
   diya", MP4/AAC as Safari records it): STT translate → parse_entry → save → translate → TTS.
2. POST /voice/ask with a question recorded by macOS `say` ("Ramesh ka kitna baaki hai?"):
   STT → Groq tool calls against the real tools → number-guarded answer → translate → TTS.
Every Sarvam/Groq request is counted; transcripts, answers and Groq messages are saved to
tests/fixtures/live/voice_*.json (no keys, no audio bytes).

Usage (from backend/): .venv/bin/python scripts/live_voice_check.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import llm_router  # noqa: E402
from app.services import sarvam as sarvam_service  # noqa: E402
from tests.conftest import Users  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "live"


class Counting:
    """Wraps the Sarvam adapter and the Groq client, counting calls and keeping what came back."""

    def __init__(self):
        self.sarvam_calls: list[dict] = []
        self.groq_calls: list[dict] = []

    def wrap_sarvam(self, s):
        log = self.sarvam_calls

        class W:
            def transcribe_to_english(self, audio, lang, mime="audio/webm", filename="note.webm"):
                r = s.transcribe_to_english(audio, lang, mime, filename)
                log.append({"call": "stt", "lang": lang, "mime": mime, "transcript": r})
                return r

            def translate(self, text, src, tgt):
                r = s.translate(text, src, tgt)
                log.append({"call": "translate", "in": text, "tgt": tgt, "out": r})
                return r

            def speak(self, text, lang, voice):
                r = s.speak(text, lang, voice)
                log.append({"call": "tts", "text": text, "lang": lang, "bytes": len(r)})
                return r
        return W()

    def wrap_groq(self, g):
        log = self.groq_calls

        class Completions:
            def create(self, **kw):
                r = g.chat.completions.create(**kw)
                m = r.choices[0].message
                log.append({"model": kw["model"], "content": m.content,
                            "tool_calls": [{"name": t.function.name, "args": t.function.arguments}
                                           for t in (m.tool_calls or [])]})
                return r

        class Chat:
            completions = Completions()

        class G:
            chat = Chat()
        return G()


def question_audio() -> bytes:
    with tempfile.TemporaryDirectory() as d:
        aiff, mp4 = Path(d) / "q.aiff", Path(d) / "q.mp4"
        subprocess.run(["say", "-o", str(aiff), "Ramesh ka kitna baaki hai?"], check=True)
        subprocess.run(["afconvert", "-f", "mp4f", "-d", "aac", "-b", "32000", str(aiff), str(mp4)], check=True)
        return mp4.read_bytes()


def main() -> None:
    c = Counting()
    sarvam_service._client = c.wrap_sarvam(sarvam_service.client())
    llm_router.groq = c.wrap_groq(llm_router.groq)
    client = TestClient(app)
    users = Users(client)
    result: dict = {}
    try:
        u = users.with_shop("Live voice check", lang="hi-IN")
        h = u["headers"]
        entry = client.post("/voice/entry", files={"audio": ("note.mp4", (ROOT / "tests/fixtures/audio/safari_note.mp4").read_bytes(),
                                                              "audio/mp4")}, headers=h)
        result["entry"] = {"status": entry.status_code, **{k: v for k, v in entry.json().items() if k != "audio_b64"},
                           "has_audio": bool(entry.json().get("audio_b64"))}
        print("ENTRY", json.dumps(result["entry"], ensure_ascii=False, indent=1)[:1500])
        balances = client.get("/parties", headers=h).json()["parties"]
        result["balances"] = balances
        ask = client.post("/voice/ask", files={"audio": ("q.mp4", question_audio(), "audio/mp4")}, headers=h)
        result["ask"] = {"status": ask.status_code, **{k: v for k, v in ask.json().items() if k != "audio_b64"},
                         "has_audio": bool(ask.json().get("audio_b64"))}
        print("ASK", json.dumps(result["ask"], ensure_ascii=False, indent=1))
    finally:
        users.cleanup()
        result["sarvam_calls"], result["groq_calls"] = c.sarvam_calls, c.groq_calls
        OUT.mkdir(parents=True, exist_ok=True)
        path = OUT / f"voice_{datetime.now():%Y%m%d_%H%M%S}.json"
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        print(f"Sarvam calls: {len(c.sarvam_calls)}  Groq calls: {len(c.groq_calls)}  → {path}")


if __name__ == "__main__":
    main()
