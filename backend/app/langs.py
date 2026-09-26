"""Per-aspect languages (GOAL_2.0 P5). Each member picks four; the three new ones are nullable
and fall back to `lang` (the language they speak in).

speech  → STT language_code (`lang`, or "unknown" = Sarvam auto-detect when speech_auto is on)
voice   → the language read-backs and answers are translated to and spoken in
report  → summaries, tips, the daily briefing and PDF reports
ui      → on-screen text (the frontend reads it from GET /me)
"""

from __future__ import annotations

from .constants import DEFAULT_VOICE

AUTO_DETECT = "unknown"   # Sarvam STT: "the API will auto-detect" (docs, 2026-09-26)


def speech_lang(m: dict) -> str:
    return AUTO_DETECT if m.get("speech_auto") else m["lang"]


def voice_lang(m: dict) -> str:
    return m.get("voice_lang") or m["lang"]


def report_lang(m: dict) -> str:
    return m.get("report_lang") or m["lang"]


def ui_lang(m: dict) -> str:
    return m.get("ui_lang") or m["lang"]


def voice_for(m: dict, lang: str | None = None) -> str:
    """The member's chosen Bulbul speaker, else the default for the language being spoken."""
    return m.get("tts_voice") or DEFAULT_VOICE.get(lang or voice_lang(m), "shubh")
