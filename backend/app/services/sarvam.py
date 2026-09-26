"""SarvamAdapter (llm_router.SarvamAdapter) on the sarvamai SDK. Signatures per docs/sarvam-notes.md.
SDK retries are disabled; we retry once on 429/503 ourselves."""

from __future__ import annotations

import base64
import os
import time
from typing import Any, Callable

from sarvamai import SarvamAI
from sarvamai.core.api_error import ApiError

from ..constants import DEFAULT_VOICE
from ..errors import AppError

NO_RETRY = {"max_retries": 0}
RETRY_STATUS = {429, 503}
RETRY_DELAY_S = 1.0


def _call(fn: Callable[[], Any]) -> Any:
    for attempt in range(2):
        try:
            return fn()
        except ApiError as e:
            if e.status_code in RETRY_STATUS and attempt == 0:
                time.sleep(RETRY_DELAY_S)
                continue
            if e.status_code in RETRY_STATUS:
                raise AppError(503, "service_busy", "Service busy, try again.")
            raise AppError(502, "speech_failed", "Couldn't process that audio. Hold the button and speak again.")


class Sarvam:
    def __init__(self) -> None:
        self.client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])

    def transcribe_to_english(self, audio: bytes, lang: str, mime: str = "audio/webm",
                              filename: str = "note.webm") -> str:
        resp = _call(lambda: self.client.speech_to_text.transcribe(
            file=(filename, audio, mime), model="saaras:v3", mode="translate",
            language_code=lang, request_options=NO_RETRY))
        return (resp.transcript or "").strip()

    def translate(self, text: str, src: str, tgt: str) -> str:
        resp = _call(lambda: self.client.text.translate(
            input=text, source_language_code=src, target_language_code=tgt,
            model="mayura:v1", mode="modern-colloquial", numerals_format="international",
            request_options=NO_RETRY))
        return resp.translated_text

    def speak(self, text: str, lang: str, voice: str | None) -> bytes:
        resp = _call(lambda: self.client.text_to_speech.convert(
            text=text[:2500], language_code=lang, model="bulbul:v3",
            speaker=voice or DEFAULT_VOICE.get(lang, "shubh"), pace=1.0,
            speech_sample_rate=24000, output_audio_codec="mp3", request_options=NO_RETRY))
        return base64.b64decode(resp.audios[0])
