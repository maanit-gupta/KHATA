"""Receipt OCR with Sarvam Document AI (CLAUDE.md §6.3, GOAL.md P2, DECISIONS D-011/D-012).

read_receipt() is the one production path; the POST /receipts BackgroundTask and
scripts/debug_receipt.py both call it:
  1. Extract {vendor_name, bill_date, total} in the user's language. Poll every 2 s, 90 s timeout.
  2. English retry, only if that job failed or `total` / `bill_date` came back empty (§6.3.5).
  3. Fallback, only if there is still no total: Digitise the bill to Markdown, let Groq pull the
     three fields out of that text (strict JSON), and keep the total only if it literally appears
     in the OCR text (number guard). Otherwise the total stays empty for the user to type.
The Sarvam adapter is passed in and `sleep` / `clock` are module globals, so tests drive the whole
lifecycle with fakes and no waiting."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Callable

from ..errors import AppError

POLL_S = 2.0      # CLAUDE.md §6.3
TIMEOUT_S = 90.0  # CLAUDE.md §6.3, per job
OK_STATES = {"completed", "partially_completed"}
BAD_STATES = {"failed", "rejected"}
FALLBACK_LANG = "en-IN"

sleep: Callable[[float], None] = time.sleep
clock: Callable[[], float] = time.monotonic

RECEIPT_SCHEMA = {"type": "object", "properties": {
    "vendor_name": {"type": "string", "description": "Name of the shop or business that issued the bill, as printed at the top"},
    "bill_date": {"type": "string", "description": "Bill date as printed"},
    "total": {"type": "number", "description": "Final amount payable in INR (grand total after taxes), as a number"}}}

DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y",
                "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d-%b-%Y", "%d-%b-%y", "%d %b %y")


class JobFailed(Exception):
    """A Document AI job ended failed/rejected or timed out."""


@dataclass
class Outcome:
    status: str                          # "done" | "failed"
    vendor_name: str | None = None
    bill_date: str | None = None         # ISO
    total_paise: int | None = None
    retried_in_english: bool = False
    used_fallback: bool = False
    job_ids: list[str] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)   # everything Sarvam returned → raw_extract
    error: str | None = None


# --- parsing -------------------------------------------------------------------------------
def parse_date(raw: Any) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_total_paise(raw: Any) -> int | None:
    """3600, 3600.0, "3,600.00", "Rs 3,600.00", "₹ 3600/-" → 360000. None when unreadable."""
    if isinstance(raw, bool) or raw in (None, ""):
        return None
    if isinstance(raw, (int, float)):
        s = repr(raw)
    else:
        m = re.search(r"\d[\d,]*(?:\.\d+)?", str(raw))
        if not m:
            return None
        s = m.group(0).replace(",", "")
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    if not d.is_finite() or d <= 0:
        return None
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _unwrap(v: Any) -> Any:
    """Tolerate leaves wrapped as {"value": ..., "confidence": ...}."""
    if isinstance(v, dict) and "value" in v:
        return v["value"]
    return v


def find_fields(result: Any) -> dict[str, Any]:
    """The first dict (depth-first) holding any of our keys. Live results are flat
    (tests/fixtures/live/receipt_*.json); nesting is tolerated in case that changes."""
    keys = set(RECEIPT_SCHEMA["properties"])
    if isinstance(result, dict):
        if keys & set(result):
            return {k: _unwrap(result.get(k)) for k in keys}
        children = list(result.values())
    elif isinstance(result, list):
        children = result
    else:
        return {}
    for child in children:
        found = find_fields(child)
        if found:
            return found
    return {}


def total_in_text(total_paise: int, text: str) -> bool:
    """Number guard (GOAL.md P2.3): the total must literally appear in the OCR text, as whole
    rupees or with paise ("3600", "3,600", "3,600.00", "3600.0")."""
    rupees, paise = divmod(total_paise, 100)
    forms = {f"{rupees}.{paise:02d}"}
    if paise % 10 == 0:
        forms.add(f"{rupees}.{paise // 10}")
    if paise == 0:
        forms.add(str(rupees))
    runs = {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text or "")}
    return bool(forms & runs)


def digitised_text(results: dict) -> str:
    """Page contents of a Digitise job, in page order."""
    pages = [p for d in results.get("documents") or [] for p in (d.get("pages") or [])]
    pages.sort(key=lambda p: p.get("page_number") or 0)
    return "\n\n".join(p.get("content") or "" for p in pages)


# --- jobs ----------------------------------------------------------------------------------
def _wait(sarvam, job_id: str) -> None:
    deadline = clock() + TIMEOUT_S
    while True:
        sleep(POLL_S)
        status = (sarvam.doc_status(job_id) or "").lower()
        if status in OK_STATES:
            return
        if status in BAD_STATES:
            raise JobFailed(f"job {status}")
        if clock() >= deadline:
            raise JobFailed("timed out after 90 s")


def run_extract(sarvam, image: bytes, filename: str, mime: str, lang: str) -> dict:
    job_id = sarvam.doc_extract_start(image, filename, mime, lang, json.dumps(RECEIPT_SCHEMA))
    _wait(sarvam, job_id)
    return {**sarvam.doc_results(job_id), "job_id": job_id, "lang": lang}


def run_digitise(sarvam, image: bytes, filename: str, mime: str, lang: str) -> dict:
    job_id = sarvam.doc_digitise_start(image, filename, mime, lang)
    _wait(sarvam, job_id)
    return {**sarvam.doc_results(job_id), "job_id": job_id, "lang": lang}


def _fields(results: dict | None) -> tuple[str | None, str | None, int | None]:
    if not results:
        return None, None, None
    f = find_fields(results.get("result"))
    vendor = str(f.get("vendor_name") or "").strip() or None
    return vendor, parse_date(f.get("bill_date")), parse_total_paise(f.get("total"))


def _attempt(fn: Callable[[], dict]) -> tuple[dict | None, str | None]:
    try:
        return fn(), None
    except (JobFailed, AppError) as e:  # AppError: busy after backoff, or a Sarvam 4xx/5xx
        return None, getattr(e, "message", None) or str(e)


def read_receipt(sarvam, image: bytes, filename: str, mime: str, lang: str,
                 fields_from_text: Callable[[str], dict] | None = None) -> Outcome:
    """fields_from_text: Groq strict-JSON reader for the fallback (llm_router.receipt_fields)."""
    out = Outcome(status="failed")
    attempts: list[dict] = []

    def extract(attempt_lang: str) -> None:
        res, err = _attempt(lambda: run_extract(sarvam, image, filename, mime, attempt_lang))
        attempts.append({"step": "extract", "lang": attempt_lang, "results": res, "error": err})
        if res:
            out.job_ids.append(res["job_id"])
        vendor, bill_date, total = _fields(res)
        out.vendor_name = out.vendor_name or vendor
        out.bill_date = out.bill_date or bill_date
        out.total_paise = out.total_paise or total

    extract(lang)
    first_failed = attempts[0]["results"] is None
    if (first_failed or not out.total_paise or not out.bill_date) and lang != FALLBACK_LANG:
        out.retried_in_english = True
        extract(FALLBACK_LANG)

    if out.total_paise is None and fields_from_text is not None:
        out.used_fallback = True
        res, err = _attempt(lambda: run_digitise(sarvam, image, filename, mime, FALLBACK_LANG))
        step = {"step": "digitise", "lang": FALLBACK_LANG, "results": res, "error": err}
        attempts.append(step)
        text = digitised_text(res) if res else ""
        if text.strip():
            try:
                f = fields_from_text(text)
            except AppError as e:
                f, step["groq_error"] = {}, e.message
            step["groq_fields"] = f
            total = parse_total_paise(f.get("total"))
            if total is not None and not total_in_text(total, text):
                step["guard"] = {"total_paise": total, "found_in_text": False}
                total = None                        # never show a number the bill doesn't have
            out.vendor_name = out.vendor_name or (str(f.get("vendor_name") or "").strip() or None)
            out.bill_date = out.bill_date or parse_date(f.get("bill_date"))
            out.total_paise = total

    out.raw = {"attempts": attempts}
    if out.total_paise is not None:
        out.status = "done"
    elif all(a["results"] is None for a in attempts):
        busy = any(a["error"] == "Service busy, try again." for a in attempts)
        out.error = ("Service busy, try again. Or type the values below." if busy
                     else "Couldn't read that bill. Type the values below.")
    else:
        out.error = "Couldn't read the total. Type the values below."
    return out
