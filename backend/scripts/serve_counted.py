"""Run the API locally with every live Sarvam/Groq HTTP attempt logged, one line per call, to
artifacts/live-calls.log, so live UI checks can be counted against the budget exactly (GOAL_2.0 §1).

Usage: backend/.venv/bin/python backend/scripts/serve_counted.py [port]
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import uvicorn  # noqa: E402

from app import config  # noqa: E402,F401  (loads backend/.env)
from app.services import llm_router, retry  # noqa: E402
from app.services import sarvam as sarvam_mod  # noqa: E402

LOG = ROOT / "artifacts" / "live-calls.log"


def _counting(service: str):
    def with_backoff(fn, status_of):
        def counted():
            with LOG.open("a") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {service}\n")
            return fn()
        return retry.with_backoff(counted, status_of)
    return with_backoff


sarvam_mod.with_backoff = _counting("sarvam")
llm_router.with_backoff = _counting("groq")

if __name__ == "__main__":
    from app.main import app
    uvicorn.run(app, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000, log_level="warning")
