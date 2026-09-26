"""Backoff for Sarvam and Groq (CLAUDE.md §8): on 429/503 retry after 1 s, 2 s, 4 s, then give up
with "Service busy, try again" and let the caller save nothing. Both SDKs have their own retries
turned off (max_retries=0), so this is the only retry layer. See DECISIONS.md D-004."""

from __future__ import annotations

import time
from typing import Callable, TypeVar

from ..errors import AppError

T = TypeVar("T")

RETRY_STATUS = frozenset({429, 503})
BACKOFF_S = (1.0, 2.0, 4.0)

# Indirection so tests can run the schedule without sleeping.
sleep: Callable[[float], None] = time.sleep


def service_busy() -> AppError:
    return AppError(503, "service_busy", "Service busy, try again.")


def with_backoff(fn: Callable[[], T], status_of: Callable[[Exception], int | None]) -> T:
    """Call fn(); when it raises an error whose status_of() is 429/503, wait and retry.
    Any other exception propagates unchanged on the first failure."""
    for delay in (*BACKOFF_S, None):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - status_of decides what is retryable
            if status_of(e) not in RETRY_STATUS:
                raise
            if delay is None:
                raise service_busy() from e
            sleep(delay)
    raise AssertionError("unreachable")
