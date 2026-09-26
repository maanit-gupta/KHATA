"""
LLM routing layer for the kirana ledger.

Division of labour
------------------
  Sarvam : eyes, ears, mouth  -> Document AI (receipts), STT (translate mode), Translate, TTS
  Groq   : reasoning          -> parse spoken entries, answer questions via tools, narrate insights
  Postgres: the truth         -> every number the user hears comes from SQL, never from an LLM

Why two Groq models
-------------------
Groq's strict Structured Outputs don't combine with tool use in the same request,
so the two jobs are split:
  * parse_entry()  -> PARSE_MODEL with response_format=json_schema, strict=True
  * answer()       -> QA_MODEL with tools (read-only), plain-text final answer

Model IDs change on Groq; confirm both against console.groq.com/docs/models before shipping.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Protocol

from groq import APIStatusError, Groq

from ..errors import AppError
from .retry import with_backoff

PARSE_MODEL = "openai/gpt-oss-20b"   # supports strict json_schema
QA_MODEL = "openai/gpt-oss-120b"     # tool calling for Q&A
MAX_TOOL_ROUNDS = 4

# Reads GROQ_API_KEY from env. SDK retries off: services/retry.py owns 429/503 backoff (CLAUDE.md §8).
groq = Groq(max_retries=0)


def _groq_status(e: Exception) -> int | None:
    return e.status_code if isinstance(e, APIStatusError) else None


def _complete(**kwargs: Any) -> Any:
    """groq.chat.completions.create with the 1 s / 2 s / 4 s backoff. `groq` is looked up per call
    so tests can swap in a fake transport."""
    try:
        return with_backoff(lambda: groq.chat.completions.create(**kwargs), _groq_status)
    except AppError:
        raise
    except Exception as e:
        raise AppError(502, "reasoning_failed", "Couldn't work that out. Try again.") from e


# ---------------------------------------------------------------------------
# Sarvam adapter — interface only. Implement with the `sarvamai` SDK and verify
# every signature against https://docs.sarvam.ai/_mcp/server (SDK changes often).
# ---------------------------------------------------------------------------
class SarvamAdapter(Protocol):
    def transcribe_to_english(self, audio: bytes, lang: str, mime: str = ..., filename: str = ...) -> str: ...  # STT, mode="translate"
    def translate(self, text: str, src: str, tgt: str) -> str: ...       # Mayura / Sarvam-Translate
    def speak(self, text: str, lang: str, voice: str | None) -> bytes: ...  # Bulbul, keep < 2500 chars


# ---------------------------------------------------------------------------
# 1) Voice -> pending ledger entry
# ---------------------------------------------------------------------------
ENTRY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["type", "party_name", "amount_rupees", "note", "occurred_on",
                 "needs_clarification", "clarification_question"],
    "properties": {
        "type": {"type": "string", "enum": [
            "credit_given", "payment_received", "cash_sale",
            "purchase_credit", "purchase_paid", "payment_made", "expense"]},
        "party_name": {"type": ["string", "null"]},
        "amount_rupees": {"type": ["number", "null"]},
        "note": {"type": ["string", "null"]},
        "occurred_on": {"type": ["string", "null"],
                        "description": "ISO date if the speaker named a day, else null (= today)"},
        "needs_clarification": {"type": "boolean"},
        "clarification_question": {"type": ["string", "null"]},
    },
}

PARSE_SYSTEM = """You convert a shopkeeper's spoken ledger note (already translated to English
by speech-to-text, so it may read awkwardly) into ONE ledger entry. Rules:
- 'udhaar', 'credit pe diya', 'baaki' -> credit_given. 'wapas diya', 'jama kiya', 'paid' by a customer -> payment_received.
- Convert numbers exactly, including leftover Hindi words: dhai sau=250, saade teen hazaar=3500,
  sava sau=125, 'two-fifty'=250, 'one thousand two hundred'=1200.
- Buying stock paid on the spot -> purchase_paid; on credit -> purchase_credit.
- If the amount, the party, or the direction of money is unclear, set needs_clarification=true
  and ask ONE short question. Never guess an amount.
- Output only fields in the schema."""


@dataclass
class ParsedEntry:
    type: str
    party_name: str | None
    amount_paise: int | None
    note: str | None
    occurred_on: str | None
    needs_clarification: bool
    clarification_question: str | None


def parse_entry(transcript: str, today_iso: str) -> ParsedEntry:
    resp = _complete(
        model=PARSE_MODEL,
        temperature=0,
        messages=[
            {"role": "system", "content": PARSE_SYSTEM + f"\nToday is {today_iso}."},
            {"role": "user", "content": transcript},
        ],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "ledger_entry", "strict": True,
                                         "schema": ENTRY_SCHEMA}},
    )
    d = json.loads(resp.choices[0].message.content)

    amount = d["amount_rupees"]
    amount_paise = round(amount * 100) if isinstance(amount, (int, float)) and amount > 0 else None

    # Deterministic guard rails on top of the model's own judgement
    needs = d["needs_clarification"] or amount_paise is None
    if d["type"] not in NO_PARTY_TYPES and not d["party_name"]:
        needs = True
    question = d["clarification_question"] if needs else None
    if needs and not question:
        question = "How much, and for whom?"  # English; goes through the same translate+TTS path

    return ParsedEntry(d["type"], d["party_name"], amount_paise, d["note"],
                       d["occurred_on"], needs, question)


# ---------------------------------------------------------------------------
# 1b) Deterministic save decision — NO LLM involved past this point
# ---------------------------------------------------------------------------
NO_PARTY_TYPES = {"cash_sale", "purchase_paid", "expense"}
AUTO_SAVE_CAP_PAISE = 500_000        # ₹5,000 — locked decision
MATCH_SCORE = 0.6                     # >= this counts as a confident name match
MATCH_MARGIN = 0.15                   # top match must beat runner-up by this much
NEAR_SCORE = 0.3                      # 0.3–0.6 = "did you mean…?"


@dataclass
class SaveDecision:
    action: str                       # "auto" | "confirm" | "clarify"
    party_action: str                 # "none" | "use_existing" | "create_flagged" | "ask_did_you_mean"
    party_id: str | None
    suggestion: str | None            # display_name for "did you mean"
    reason: str | None                # stored in entries.review_reason


def decide_save(p: ParsedEntry, matches: list[dict]) -> SaveDecision:
    """matches = rows from SQL find_party(shop, name, kind), sorted by score desc,
    each {"party_id", "display_name", "score"}. Only scores >= 0.3 are returned."""
    if p.needs_clarification:
        return SaveDecision("clarify", "none", None, None, p.clarification_question)

    party_action, party_id, suggestion = "none", None, None
    if p.type not in NO_PARTY_TYPES:
        top = matches[0] if matches else None
        runner = matches[1]["score"] if len(matches) > 1 else 0.0
        if top and top["score"] >= MATCH_SCORE and top["score"] - runner >= MATCH_MARGIN:
            party_action, party_id = "use_existing", top["party_id"]
        elif top:  # something close but not certain -> never silently create a duplicate
            return SaveDecision("confirm", "ask_did_you_mean", None, top["display_name"],
                                f"Did you mean {top['display_name']}?")
        else:
            party_action = "create_flagged"          # parties.needs_review = true

    if p.amount_paise > AUTO_SAVE_CAP_PAISE:
        return SaveDecision("confirm", party_action, party_id, None, "amount above ₹5,000")
    return SaveDecision("auto", party_action, party_id, None,
                        "new party created automatically" if party_action == "create_flagged" else None)
    # "auto"    -> insert status='confirmed', auto_saved=true; UI shows Undo for 5 s (Undo = void)
    # "confirm" -> insert status='pending' with review_reason; UI shows the card to tap
    # "clarify" -> insert nothing; speak clarification_question; user records again


# ---------------------------------------------------------------------------
# 2) Voice question -> tool calls (READ-ONLY) -> spoken answer
# ---------------------------------------------------------------------------
QA_TOOLS = [
    {"type": "function", "function": {
        "name": "find_party",
        "description": "Fuzzy-match a customer/supplier name the user mentioned. Call before any party-specific tool.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["name"],
                       "properties": {"name": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "get_party_balance",
        "description": "Current balance for one party. Positive = they owe the shop.",
        "parameters": {"type": "object", "additionalProperties": False, "required": ["party_id"],
                       "properties": {"party_id": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "list_entries",
        "description": "Confirmed entries, newest first, optionally filtered.",
        "parameters": {"type": "object", "additionalProperties": False, "required": [],
                       "properties": {
                           "party_id": {"type": "string"},
                           "type": {"type": "string"},
                           "from_date": {"type": "string"}, "to_date": {"type": "string"},
                           "limit": {"type": "integer", "maximum": 20}}}}},
    {"type": "function", "function": {
        "name": "get_period_summary",
        "description": "Totals (cash sales, credit given, collected, purchases, supplier payments, expenses) between two ISO dates.",
        "parameters": {"type": "object", "additionalProperties": False,
                       "required": ["from_date", "to_date"],
                       "properties": {"from_date": {"type": "string"}, "to_date": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "top_debtors",
        "description": "Parties who owe the most, with days since last activity.",
        "parameters": {"type": "object", "additionalProperties": False, "required": [],
                       "properties": {"limit": {"type": "integer", "maximum": 10}}}}},
]

QA_SYSTEM = """You are a ledger assistant for a small Indian shop. Answer in plain English
in at most 2 short sentences, because your answer will be translated and spoken aloud.
- Use ONLY numbers returned by tools. Never add, subtract or estimate yourself; if a total
  is needed, call the tool that returns it.
- Write amounts as digits with the rupee word, e.g. "1250 rupees".
- If find_party returns several close matches, ask which one (name them). If none, say so.
- You cannot create, edit or delete entries. If asked, tell the user to use the Add button."""


QA_FALLBACK = "I could not answer that reliably. Try asking a different way."
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _decimals(text: str) -> set[Decimal]:
    out = set()
    for n in _NUMBER.findall(text):
        try:
            out.add(Decimal(n.replace(",", "")).normalize())
        except InvalidOperation:
            continue
    return out


def numbers_grounded(answer_text: str, sources: list[str]) -> bool:
    """Every number in the answer must appear (by value) in a tool result or the question:
    "every number spoken or shown comes from SQL" (GOAL.md §1.2)."""
    allowed: set[Decimal] = set()
    for src in sources:
        allowed |= _decimals(src)
    return _decimals(answer_text) <= allowed


def answer(question_en: str, shop_id: str, today_iso: str,
           tools_impl: dict[str, Callable[..., Any]]) -> str:
    """tools_impl maps tool name -> function(shop_id, **args) that runs SQL and returns JSON-able data.
    shop_id is injected by the server, never taken from the model, so one shop can't read another.
    The final answer is refused (QA_FALLBACK) if it states a number no tool returned."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": QA_SYSTEM + f"\nToday is {today_iso}."},
        {"role": "user", "content": question_en},
    ]
    evidence: list[str] = [question_en]
    for _ in range(MAX_TOOL_ROUNDS):
        resp = _complete(
            model=QA_MODEL, temperature=0.1, messages=messages,
            tools=QA_TOOLS, tool_choice="auto",
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            text = (msg.content or "").strip()
            if not text or not numbers_grounded(text, evidence):
                return QA_FALLBACK
            return text

        messages.append({"role": "assistant", "content": msg.content or "",
                         "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:  # may be several per turn — handle them all
            fn = tools_impl.get(tc.function.name)
            try:
                args = json.loads(tc.function.arguments or "{}")
                result = fn(shop_id, **args) if fn else {"error": "unknown tool"}
            except Exception as e:  # bad args or DB error -> let the model recover
                result = {"error": str(e)}
            content = json.dumps(result, default=str)
            evidence.append(content)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": content})
    return QA_FALLBACK


# ---------------------------------------------------------------------------
# 3) Language bridge with a number guard
# ---------------------------------------------------------------------------
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[str]:
    return sorted(n.replace(",", "") for n in _NUM.findall(text))


def localize_for_speech(answer_en: str, lang: str, sarvam: SarvamAdapter) -> str:
    """Translate the English answer for TTS, but refuse any translation that
    changed, dropped or invented a number. Falls back to English if so."""
    if lang.startswith("en"):
        return answer_en
    translated = sarvam.translate(answer_en, "en-IN", lang)
    if _numbers(translated) != _numbers(answer_en):
        return answer_en  # a wrong amount in Tamil is worse than a right one in English
    return translated


@dataclass
class QAResult:
    question_en: str
    reply_en: str
    reply_local: str
    audio: bytes | None


NOT_HEARD_QUESTION = "I did not hear a question. Please ask again."


def voice_question_pipeline(audio: bytes, shop_id: str, member: dict, today_iso: str,
                            sarvam: SarvamAdapter, tools_impl: dict, *, mime: str = "audio/webm",
                            filename: str = "note.webm") -> QAResult:
    """member = the caller's shop_members row: language is per user, not per shop.
    STT (translate) -> answer with read-only tools -> localize + number guard -> TTS.
    A translate or TTS failure falls back to English text / no audio; the answer still shows."""
    lang = member["lang"]
    question_en = sarvam.transcribe_to_english(audio, lang, mime, filename)   # speech -> English text
    reply_en = answer(question_en, shop_id, today_iso, tools_impl) if question_en.strip() else NOT_HEARD_QUESTION
    try:
        reply_local = localize_for_speech(reply_en, lang, sarvam)
    except AppError:
        reply_local = reply_en
    try:
        spoken = sarvam.speak(reply_local, lang, member.get("tts_voice"))
    except AppError:
        spoken = None
    return QAResult(question_en, reply_en, reply_local, spoken)


# ---------------------------------------------------------------------------
# 3b) Receipt fallback: OCR text -> the three bill fields (strict JSON)
# ---------------------------------------------------------------------------
RECEIPT_FIELDS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["vendor_name", "bill_date", "total"],
    "properties": {
        "vendor_name": {"type": ["string", "null"]},
        "bill_date": {"type": ["string", "null"], "description": "As printed, e.g. 24/09/2026"},
        "total": {"type": ["number", "null"], "description": "Grand total payable, INR"},
    },
}

RECEIPT_SYSTEM = """You read the OCR text of one Indian shop bill and return three fields.
- vendor_name: the business that issued the bill (usually the first line), not the customer.
- bill_date: the bill date exactly as printed, or null.
- total: the final amount payable (grand total / net amount after taxes and round-off), copied
  exactly from the text as a number. Never add up items yourself. If unsure, null.
Output only fields in the schema."""


def receipt_fields(ocr_text: str) -> dict:
    """Used only when Document AI Extract found no total. The caller checks the total against
    the OCR text (number guard) before showing it."""
    resp = _complete(
        model=PARSE_MODEL,
        temperature=0,
        messages=[{"role": "system", "content": RECEIPT_SYSTEM},
                  {"role": "user", "content": ocr_text[:12000]}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "receipt_fields", "strict": True,
                                         "schema": RECEIPT_FIELDS_SCHEMA}},
    )
    return json.loads(resp.choices[0].message.content)


# ---------------------------------------------------------------------------
# 4) Insight narration — SQL computes, Groq only phrases
# ---------------------------------------------------------------------------
def narrate_insights(metrics: dict[str, Any]) -> str:
    """metrics comes from daily_summary / party_balances, e.g.
    {"week_cash_sales": 41200, "prev_week_cash_sales": 38000,
     "overdue": [{"name": "Ramesh", "balance": 2300, "days": 34}]}"""
    resp = _complete(
        model=PARSE_MODEL, temperature=0.3,
        messages=[
            {"role": "system", "content":
                "Summarise these shop metrics in 3 short spoken sentences for the owner. "
                "Use only the numbers given, copied exactly. Mention one action they could take."},
            {"role": "user", "content": json.dumps(metrics)},
        ],
    )
    return resp.choices[0].message.content.strip()
