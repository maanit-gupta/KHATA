"""SarvamAdapter (llm_router.SarvamAdapter) on the sarvamai SDK. Signatures per docs/sarvam-notes.md.
SDK retries are disabled; we retry once on 429/503 ourselves."""

from __future__ import annotations

import base64
import json
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

    def extract_receipt(self, image: bytes, filename: str, mime: str, lang: str,
                        timeout_s: float = 60, poll_s: float = 2) -> dict:
        """Document AI extract, polled synchronously. Returns model_dump() of the results.
        Raises AppError on failure or timeout."""
        job = _call(lambda: self.client.doc_ai.extract(
            file=[(filename, image, mime)], schema=json.dumps(RECEIPT_SCHEMA), language=lang,
            output_format="json", request_options=NO_RETRY))
        deadline = time.monotonic() + timeout_s
        while True:
            st = _call(lambda: self.client.doc_ai.get_status(job.job_id, request_options=NO_RETRY))
            if st.status in ("completed", "partially_completed"):
                break
            if st.status in ("failed", "rejected"):
                raise AppError(502, "ocr_failed", "Couldn't read that bill. Type the values below.")
            if time.monotonic() > deadline:
                raise AppError(504, "ocr_timeout", "Reading the bill took too long. Type the values below.")
            time.sleep(poll_s)
        res = _call(lambda: self.client.doc_ai.get_results(job.job_id, request_options=NO_RETRY))
        return {"job_id": job.job_id, **res.model_dump(mode="json")}


RECEIPT_SCHEMA = {"type": "object", "properties": {
    "vendor_name": {"type": "string", "description": "Name of the shop or business that issued the bill, as printed at the top"},
    "bill_date": {"type": "string", "description": "Bill date as printed"},
    "total": {"type": "number", "description": "Final amount payable in INR (grand total after taxes), as a number"}}}
