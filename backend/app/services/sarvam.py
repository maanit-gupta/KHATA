"""SarvamAdapter (llm_router.SarvamAdapter) on the sarvamai SDK. Signatures per docs/sarvam-notes.md.
SDK retries are disabled; services/retry.py retries 429/503 at 1 s / 2 s / 4 s (CLAUDE.md §8)."""

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
from .retry import with_backoff

NO_RETRY = {"max_retries": 0}


def _status(e: Exception) -> int | None:
    return e.status_code if isinstance(e, ApiError) else None


def _call(fn: Callable[[], Any], failed: AppError) -> Any:
    try:
        return with_backoff(fn, _status)
    except AppError:
        raise
    except ApiError as e:
        if e.status_code in (402, 403):
            raise AppError(503, "service_unavailable",
                           "The speech service is not available right now. Type the entry by hand.") from e
        raise failed from e
    except Exception as e:  # network errors, SDK validation errors
        raise failed from e


def _speech_failed() -> AppError:
    return AppError(502, "speech_failed", "Couldn't process that audio. Hold the button and speak again.")


def _voice_failed() -> AppError:
    return AppError(502, "voice_failed", "Couldn't make the spoken reply. The text is shown instead.")


class Sarvam:
    def __init__(self) -> None:
        self.client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])

    def transcribe_to_english(self, audio: bytes, lang: str, mime: str = "audio/webm",
                              filename: str = "note.webm") -> str:
        resp = _call(lambda: self.client.speech_to_text.transcribe(
            file=(filename, audio, mime), model="saaras:v3", mode="translate",
            language_code=lang, request_options=NO_RETRY), _speech_failed())
        return (resp.transcript or "").strip()

    def translate(self, text: str, src: str, tgt: str) -> str:
        resp = _call(lambda: self.client.text.translate(
            input=text, source_language_code=src, target_language_code=tgt,
            model="mayura:v1", mode="modern-colloquial", numerals_format="international",
            request_options=NO_RETRY), _voice_failed())
        return resp.translated_text

    def speak(self, text: str, lang: str, voice: str | None) -> bytes:
        resp = _call(lambda: self.client.text_to_speech.convert(
            text=text[:2500], language_code=lang, model="bulbul:v3",
            speaker=voice or DEFAULT_VOICE.get(lang, "shubh"), pace=1.0,
            speech_sample_rate=24000, output_audio_codec="mp3", request_options=NO_RETRY),
            _voice_failed())
        return base64.b64decode(resp.audios[0])

    def extract_receipt(self, image: bytes, filename: str, mime: str, lang: str,
                        timeout_s: float = 60, poll_s: float = 2) -> dict:
        """Document AI extract, polled synchronously. Returns model_dump() of the results.
        Raises AppError on failure or timeout."""
        failed = AppError(502, "ocr_failed", "Couldn't read that bill. Type the values below.")
        job = _call(lambda: self.client.doc_ai.extract(
            file=[(filename, image, mime)], schema=json.dumps(RECEIPT_SCHEMA), language=lang,
            output_format="json", request_options=NO_RETRY), failed)
        deadline = time.monotonic() + timeout_s
        while True:
            st = _call(lambda: self.client.doc_ai.get_status(job.job_id, request_options=NO_RETRY), failed)
            if st.status in ("completed", "partially_completed"):
                break
            if st.status in ("failed", "rejected"):
                raise failed
            if time.monotonic() > deadline:
                raise AppError(504, "ocr_timeout", "Reading the bill took too long. Type the values below.")
            time.sleep(poll_s)
        res = _call(lambda: self.client.doc_ai.get_results(job.job_id, request_options=NO_RETRY), failed)
        return {"job_id": job.job_id, **res.model_dump(mode="json")}


RECEIPT_SCHEMA = {"type": "object", "properties": {
    "vendor_name": {"type": "string", "description": "Name of the shop or business that issued the bill, as printed at the top"},
    "bill_date": {"type": "string", "description": "Bill date as printed"},
    "total": {"type": "number", "description": "Final amount payable in INR (grand total after taxes), as a number"}}}


_client: Any = None


def client() -> Any:
    """The process-wide adapter. Tests swap it for a fake with set_client()."""
    global _client
    if _client is None:
        _client = Sarvam()
    return _client


def set_client(c: Any) -> None:
    global _client
    _client = c
