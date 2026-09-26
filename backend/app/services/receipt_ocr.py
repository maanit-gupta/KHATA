"""Receipt OCR with Sarvam Document AI (CLAUDE.md §6.3, GOAL.md P2, GOAL_2.0 P1.3/P2.4,
DECISIONS D-011/D-012/D-050).

read_receipt() is the one production path; the POST /receipts BackgroundTask and
scripts/harness.py both call it:
  1. Extract {vendor_name, bill_date, total} and Digitise (the bill's full text, Markdown) start
     together in the user's language and are polled in the same 2 s ticks, 90 s timeout each.
     The text is kept as `ocr_text` ("WHAT I READ") and is what the number guard checks against.
  2. English retry of Extract, only if that job failed or `total` / `bill_date` came back empty
     (§6.3.5). No retry for en-IN users (D-013).
  3. Fallback, only if there is still no total: Groq pulls the three fields out of the OCR text
     (strict JSON), and its total is kept only if it literally appears in the text. If the first
     Digitise gave no text, one English Digitise is tried first.
  4. Number guard on Extract's total too: a total that isn't printed anywhere in the OCR text is
     kept but flagged total_check="check" so the form says "Check this".
The Sarvam adapter is passed in and `sleep` / `clock` are module globals, so tests drive the whole
lifecycle with fakes and no waiting."""

from __future__ import annotations

import html
import json
import re
import time
import unicodedata
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
    total_check: str | None = None       # "ok" (printed on the bill) | "check" (not found in the text)
    ocr_text: str | None = None          # Digitise Markdown: what the bill says, unprocessed
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
    (verified live, DECISIONS D-011); nesting is tolerated in case that changes."""
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


def ascii_digits(text: str) -> str:
    """Indic digits (०-९, ௦-௯, ...) → 0-9, so a bill printed in native numerals still passes the
    number guard."""
    return "".join(str(unicodedata.digit(ch)) if ch.isdigit() and not ch.isascii() else ch for ch in text or "")


def total_in_text(total_paise: int, text: str) -> bool:
    """Number guard (GOAL.md P2.3): the total must literally appear in the OCR text, as whole
    rupees or with paise ("3600", "3,600", "3,600.00", "3600.0")."""
    rupees, paise = divmod(total_paise, 100)
    forms = {f"{rupees}.{paise:02d}"}
    if paise % 10 == 0:
        forms.add(f"{rupees}.{paise // 10}")
    if paise == 0:
        forms.add(str(rupees))
    runs = {n.replace(",", "") for n in re.findall(r"[0-9][0-9,]*(?:\.[0-9]+)?", ascii_digits(text))}
    return bool(forms & runs)


def _block_text(text: str) -> str:
    """One Digitise block as plain lines. Tables arrive as HTML: rows become lines and cells are
    joined with " | ", so the text reads like the bill and every printed number survives as-is."""
    if "<" not in text:
        return text.strip()
    text = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", " | ", text)
    text = re.sub(r"</tr>|<br\s*/?>", "\n", text)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return "\n".join(line.strip(" |") for line in text.splitlines() if line.strip(" |\t"))


def digitised_text(results: dict) -> str:
    """The text of a Digitise job, page by page. Live results carry each page as `blocks` (text +
    reading_order, tables as HTML) even with output_format="md"; a page `content` string is used
    when present (DECISIONS D-050: reading only `content` returned empty text for every bill)."""
    pages = [p for d in results.get("documents") or [] for p in (d.get("pages") or [])]
    pages.sort(key=lambda p: p.get("page_number") or 0)
    out = []
    for page in pages:
        if (page.get("content") or "").strip():
            out.append(page["content"].strip())
            continue
        blocks = sorted(page.get("blocks") or [], key=lambda b: b.get("reading_order") or 0)
        out.append("\n".join(t for t in (_block_text(b.get("text") or "") for b in blocks) if t))
    return "\n\n".join(t for t in out if t)


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


def _wait_all(sarvam, jobs: dict[str, str]) -> dict[str, tuple[dict | None, str | None]]:
    """Poll jobs that started together in the same 2 s ticks. {name: (results, error)}."""
    deadline = clock() + TIMEOUT_S
    pending, out = dict(jobs), {}
    while pending:
        sleep(POLL_S)
        for name, job_id in list(pending.items()):
            try:
                status = (sarvam.doc_status(job_id) or "").lower()
                if status in OK_STATES:
                    out[name] = ({**sarvam.doc_results(job_id), "job_id": job_id}, None)
                elif status in BAD_STATES:
                    out[name] = (None, f"job {status}")
                else:
                    continue
            except AppError as e:
                out[name] = (None, e.message)
            del pending[name]
        if pending and clock() >= deadline:
            out.update({name: (None, "timed out after 90 s") for name in pending})
            break
    return out


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


def _start(fn: Callable[[], str]) -> tuple[str | None, str | None]:
    try:
        return fn(), None
    except AppError as e:
        return None, e.message


def read_receipt(sarvam, image: bytes, filename: str, mime: str, lang: str,
                 fields_from_text: Callable[[str], dict] | None = None,
                 on_stage: Callable[[str], None] | None = None) -> Outcome:
    """fields_from_text: Groq strict-JSON reader for the fallback (llm_router.receipt_fields).
    on_stage("checking") is called once the first read is back and the checks (English retry,
    fallback, number guard) begin, so the scan screen can say so truthfully (GOAL_2.0 P2.3)."""
    out = Outcome(status="failed")
    attempts: list[dict] = []
    extract_total: int | None = None

    def take(res: dict | None) -> None:
        nonlocal extract_total
        if res:
            out.job_ids.append(res["job_id"])
        vendor, bill_date, total = _fields(res)
        out.vendor_name = out.vendor_name or vendor
        out.bill_date = out.bill_date or bill_date
        out.total_paise = out.total_paise or total
        extract_total = extract_total or total

    # 1. Extract + Digitise, side by side.
    ext_id, ext_err = _start(lambda: sarvam.doc_extract_start(image, filename, mime, lang, json.dumps(RECEIPT_SCHEMA)))
    dig_id, dig_err = _start(lambda: sarvam.doc_digitise_start(image, filename, mime, lang))
    got = _wait_all(sarvam, {k: v for k, v in (("extract", ext_id), ("digitise", dig_id)) if v})
    ext_res, ext_err = got.get("extract", (None, ext_err))
    dig_res, dig_err = got.get("digitise", (None, dig_err))
    attempts.append({"step": "extract", "lang": lang, "results": ext_res and {**ext_res, "lang": lang}, "error": ext_err})
    attempts.append({"step": "digitise", "lang": lang, "results": dig_res and {**dig_res, "lang": lang}, "error": dig_err})
    take(ext_res)
    text = digitised_text(dig_res) if dig_res else ""
    if on_stage:
        on_stage("checking")

    # 2. English retry of Extract (§6.3.5).
    if (ext_res is None or not out.total_paise or not out.bill_date) and lang != FALLBACK_LANG:
        out.retried_in_english = True
        res, err = _attempt(lambda: run_extract(sarvam, image, filename, mime, FALLBACK_LANG))
        attempts.append({"step": "extract", "lang": FALLBACK_LANG, "results": res, "error": err})
        take(res)

    # 3. Fallback: read the fields out of the OCR text.
    if out.total_paise is None and fields_from_text is not None:
        out.used_fallback = True
        if not text.strip() and lang != FALLBACK_LANG:
            res, err = _attempt(lambda: run_digitise(sarvam, image, filename, mime, FALLBACK_LANG))
            attempts.append({"step": "digitise", "lang": FALLBACK_LANG, "results": res, "error": err})
            text = digitised_text(res) if res else ""
        step: dict[str, Any] = {"step": "fields_from_text"}
        attempts.append(step)
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
        else:
            step["skipped"] = "no OCR text"

    # 4. Number guard on the total that will be shown.
    out.ocr_text = text or None
    if out.total_paise is not None:
        out.total_check = "ok" if text and total_in_text(out.total_paise, text) else "check"

    out.raw = {"attempts": attempts, "total_check": out.total_check}
    if out.total_paise is not None:
        out.status = "done"
    elif all(a.get("results") is None for a in attempts if "results" in a):
        busy = any(a.get("error") == "Service busy, try again." for a in attempts)
        out.error = ("Service busy, try again. Or type the values below." if busy
                     else "Couldn't read that bill. Type the values below.")
    else:
        out.error = "Couldn't read the total. Type the values below."
    return out
