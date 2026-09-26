"""Per-user rate limits for the routes that spend Sarvam/Groq credits (GOAL.md P8.5, D-037).

A simple in-memory token bucket per (bucket, user): `capacity` requests at once, refilled
continuously at `capacity` per minute. In-memory means per process: fine for the single free
Render instance; a second instance would give each user twice the budget, which is still bounded.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

from fastapi import Depends

from .auth import CurrentUser, current_user
from .errors import AppError

clock: Callable[[], float] = time.monotonic   # tests patch this

LIMITS = {                 # name: requests per minute (also the burst size)
    "voice": 12,           # POST /voice/entry, /voice/entry/resolve, /voice/ask
    "receipts": 5,         # POST /receipts (each bill is several Document AI calls; Sarvam allows 10/min)
    "tts": 10,             # POST /tts
}

_lock = threading.Lock()
_buckets: dict[tuple[str, str], tuple[float, float]] = {}   # (name, user) -> (tokens, last_seen)


def take(name: str, user_id: str) -> bool:
    capacity = LIMITS[name]
    rate = capacity / 60.0
    now = clock()
    with _lock:
        tokens, last = _buckets.get((name, user_id), (float(capacity), now))
        tokens = min(float(capacity), tokens + (now - last) * rate)
        if tokens < 1.0:
            _buckets[(name, user_id)] = (tokens, now)
            return False
        _buckets[(name, user_id)] = (tokens - 1.0, now)
        return True


def reset() -> None:
    with _lock:
        _buckets.clear()


def rate_limit(name: str):
    """Route dependency: `dependencies=[Depends(rate_limit("voice"))]`."""
    def check(user: CurrentUser = Depends(current_user)) -> None:
        if not take(name, user.id):
            raise AppError(429, "rate_limited", "Too many requests. Wait a minute, then try again.")
    check.__name__ = f"rate_limit_{name}"
    return check
