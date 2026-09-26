"""Every spoken line goes: English text → localize_for_speech (translate + number guard) → TTS
(CLAUDE.md §2, §9b). The English is always composed server-side from SQL numbers."""

from __future__ import annotations

import base64
import logging

from .errors import AppError
from .services import llm_router
from .services import sarvam as sarvam_service

log = logging.getLogger("khata")


def localize(text_en: str, member: dict) -> str:
    """Translated text, or the English when translation fails or changes a number."""
    try:
        return llm_router.localize_for_speech(text_en, member["lang"], sarvam_service.client())
    except AppError:
        log.warning("translate failed; speaking English")
        return text_en


def speak(text_en: str, member: dict, strict: bool = False) -> tuple[str, str | None]:
    """(text as spoken, base64 mp3). A TTS failure never undoes a save, so by default it returns
    (text, None) and the UI shows the text. strict=True (POST /tts) raises instead."""
    local = localize(text_en, member)
    try:
        audio = sarvam_service.client().speak(local, member["lang"], member.get("tts_voice"))
        return local, base64.b64encode(audio).decode()
    except AppError:
        if strict:
            raise
        log.warning("tts failed; returning text only")
        return local, None
