"""SarvamAdapter (llm_router.SarvamAdapter) on the sarvamai SDK. Signatures per docs/sarvam-notes.md.
SDK retries are disabled; services/retry.py retries 429/503 at 1 s / 2 s / 4 s (CLAUDE.md §8)."""

from __future__ import annotations

import base64
import os
from typing import Any, Callable

from sarvamai import SarvamAI
from sarvamai.core.api_error import ApiError

from ..constants import DEFAULT_VOICE, TRANSLATE
from ..errors import AppError
from .llm_router import Heard
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
                              filename: str = "note.webm", keyterms: list[str] | None = None) -> str:
        """saaras:v3 translate mode (CLAUDE.md §9b). With `keyterms` (the STT_PRIME_PARTY_NAMES
        flag, off by default) it uses saaras:v4, the only model that accepts them (D-045)."""
        extra: dict = {"model": "saaras:v3"}
        if keyterms:
            extra = {"model": "saaras:v4", "keyterms": keyterms[:50]}
        resp = _call(lambda: self.client.speech_to_text.transcribe(
            file=(filename, audio, mime), mode="translate", language_code=lang,
            request_options=NO_RETRY, **extra), _speech_failed())
        # Exactly what Sarvam said, unprocessed (GOAL_2.0 P1.3); callers use .text (stripped).
        return Heard(resp.transcript or "", getattr(resp, "language_code", None), getattr(resp, "request_id", None))

    def translate(self, text: str, src: str, tgt: str, model: str | None = None, mode: str | None = None) -> str:
        """Model and mode come from constants.TRANSLATE per target language unless given."""
        cfg = TRANSLATE.get(tgt, {"model": "mayura:v1", "mode": "modern-colloquial"})
        model = model or cfg["model"]
        mode = "formal" if model == "sarvam-translate:v1" else (mode or cfg["mode"])
        resp = _call(lambda: self.client.text.translate(
            input=text, source_language_code=src, target_language_code=tgt,
            model=model, mode=mode, numerals_format="international",
            request_options=NO_RETRY), _voice_failed())
        return resp.translated_text

    def speak(self, text: str, lang: str, voice: str | None) -> bytes:
        resp = _call(lambda: self.client.text_to_speech.convert(
            text=text[:2500], language_code=lang, model="bulbul:v3",
            speaker=voice or DEFAULT_VOICE.get(lang, "shubh"), pace=1.0,
            speech_sample_rate=24000, output_audio_codec="mp3", request_options=NO_RETRY),
            _voice_failed())
        return base64.b64decode(resp.audios[0])

    # --- Document AI (receipts). services/receipt_ocr.py drives the job lifecycle. ---
    def doc_extract_start(self, image: bytes, filename: str, mime: str, lang: str, schema_json: str) -> str:
        job = _call(lambda: self.client.doc_ai.extract(
            file=[(filename, image, mime)], schema=schema_json, language=lang,
            output_format="json", request_options=NO_RETRY), _ocr_failed())
        return job.job_id

    def doc_digitise_start(self, image: bytes, filename: str, mime: str, lang: str) -> str:
        job = _call(lambda: self.client.doc_ai.digitise(
            file=[(filename, image, mime)], language=lang, output_format="md",
            request_options=NO_RETRY), _ocr_failed())
        return job.job_id

    def doc_status(self, job_id: str) -> str:
        st = _call(lambda: self.client.doc_ai.get_status(job_id, request_options=NO_RETRY), _ocr_failed())
        return str(st.status)

    def doc_results(self, job_id: str) -> dict:
        res = _call(lambda: self.client.doc_ai.get_results(job_id, request_options=NO_RETRY), _ocr_failed())
        return res.model_dump(mode="json")


def _ocr_failed() -> AppError:
    return AppError(502, "ocr_failed", "Couldn't read that bill. Type the values below.")


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
