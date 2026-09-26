"""Run one receipt image through the production OCR path with LIVE Sarvam calls, and save every
raw response to tests/fixtures/live/receipt_<stamp>.json (GOAL.md P2.1).

Every HTTP request to Sarvam is counted and printed, because the run has a live-call budget
(GOAL.md §1.3). Nothing touches the database.

Usage (from backend/):
    .venv/bin/python scripts/debug_receipt.py tests/fixtures/receipts/printed_bill.png hi-IN [first_poll_s]
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402,F401  (loads backend/.env)
from app.services import llm_router, receipt_ocr  # noqa: E402
from app.services.sarvam import Sarvam  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "live"


class Recorder:
    """Wraps SDK doc_ai methods: counts calls and keeps each raw response."""

    def __init__(self, doc_ai):
        self._doc_ai = doc_ai
        self.log: list[dict] = []

    def __getattr__(self, name):
        fn = getattr(self._doc_ai, name)
        if not callable(fn):
            return fn

        def wrapped(*args, **kwargs):
            started = time.monotonic()
            entry = {"call": name, "kwargs": {k: v for k, v in kwargs.items()
                                              if k not in ("file", "request_options")}}
            try:
                out = fn(*args, **kwargs)
                entry["response"] = out.model_dump(mode="json") if hasattr(out, "model_dump") else repr(out)
                return out
            except Exception as e:
                entry["error"] = {"type": type(e).__name__, "status": getattr(e, "status_code", None),
                                  "body": getattr(e, "body", None)}
                raise
            finally:
                entry["seconds"] = round(time.monotonic() - started, 2)
                self.log.append(entry)
        return wrapped


def budget_sleep(first_poll_s: float):
    """Production polls every 2 s. To save live calls, the first wait of each job can be longer;
    everything else is the production path. (A single-page bill took ~14 s in run 1.)"""
    state = {"n": 0}

    def sleep(seconds: float) -> None:
        state["n"] += 1
        time.sleep(first_poll_s if first_poll_s and state["n"] == 1 else seconds)
    return sleep


def main(image_path: str, lang: str, first_poll_s: float = 0) -> None:
    image = Path(image_path).read_bytes()
    mime = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
    sarvam = Sarvam()
    rec = Recorder(sarvam.client.doc_ai)
    real = sarvam.client

    class ClientProxy:  # SarvamAI.doc_ai is a read-only property, so proxy the whole client
        doc_ai = rec

        def __getattr__(self, name):
            return getattr(real, name)
    sarvam.client = ClientProxy()  # type: ignore[assignment]
    outcome, error = None, None
    try:
        real_wait = receipt_ocr._wait

        def wait(*a, **kw):  # a fresh first-poll wait for each job (English retry, fallback too)
            receipt_ocr.sleep = budget_sleep(first_poll_s)
            return real_wait(*a, **kw)
        receipt_ocr._wait = wait
        outcome = receipt_ocr.read_receipt(sarvam, image, Path(image_path).name, mime, lang,
                                           fields_from_text=llm_router.receipt_fields)
    except Exception as e:  # keep the raw log even when the run fails
        error = f"{type(e).__name__}: {e}"
    FIXTURES.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = FIXTURES / f"receipt_{stamp}_{lang}.json"
    out.write_text(json.dumps({"image": Path(image_path).name, "lang": lang, "error": error,
                               "outcome": outcome.__dict__ if outcome else None,
                               "sarvam_calls": len(rec.log), "log": rec.log}, indent=2, default=str))
    print(f"Sarvam HTTP calls: {len(rec.log)}  ->  {out}")
    print(json.dumps(outcome.__dict__ if outcome else {"error": error}, indent=2, default=str)[:3000])


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) == 4 else 0)
