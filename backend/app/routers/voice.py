"""Voice entry (CLAUDE.md §5, §6.1, §9b).

POST /voice/entry: audio → Storage + voice_notes → STT (translate) → parse_entry → find_party →
  decide_save. An optional `answer_to` (the voice_note_id of a clarify question) joins the
  earlier transcript with this one, "first + ' ' + answer", and parses the joined text (§9b).
POST /voice/entry/resolve: the "Did you mean X?" card. use_suggested / create_new re-runs
  decide_save with that party and applies the amount rule again.
Every read-back is composed in English here and localized with the number guard (speech.speak)."""

from __future__ import annotations

import base64
import logging
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, ConfigDict

from ..auth import CurrentUser, current_user
from ..config import stt_prime_party_names
from ..langs import speech_lang
from ..qa_tools import make_tools
from ..ratelimit import rate_limit
from ..db import user_client
from ..errors import AppError
from ..ledger import (NO_PARTY_TYPES, check_uuid, expense_category, not_found, now_iso, parse_iso_date, party_kind_for,
                      require_membership, today_ist)
from ..services import llm_router
from ..services.sarvam import client as sarvam
from ..speech import speak
from ..storage import AUDIO_TYPES, read_upload, upload
from .entries import fetch_entry, get_or_create_party

log = logging.getLogger("khata")
router = APIRouter()

MIN_AUDIO_BYTES = 1000  # an empty WebM container is ~100 bytes: the button was tapped, not held
TYPE_WORDS = {"credit_given": "udhaar", "payment_received": "payment received",
              "cash_sale": "cash sale", "purchase_credit": "purchase on credit",
              "purchase_paid": "purchase paid", "payment_made": "payment made", "expense": "expense"}
NOT_HEARD = "I didn't catch that. Hold the button and say it again."


def spoken_rupees(paise: int) -> str:
    """Digits with Indian grouping (Bulbul reads "10,000" better than "10000"; the number guard
    ignores commas)."""
    rupees, p = divmod(paise, 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        s = ",".join([head, *groups, tail]) if head else ",".join([*groups, tail])
    return f"{s}.{p:02d}" if p else s


def read_back(parsed: llm_router.ParsedEntry, name: str | None, action: str, suggestion: str | None) -> str:
    who = f"{name}, " if name else ""
    said = f"{who}{spoken_rupees(parsed.amount_paise)} rupees {TYPE_WORDS[parsed.type]}"
    if action == "auto":
        return f"{said}, saved."
    if suggestion:
        return f"{said}. Did you mean {suggestion}?"
    return f"{said}. Tap confirm to save."


def _read_audio(audio: UploadFile) -> tuple[bytes, str, str]:
    data, mime, ext = read_upload(audio, AUDIO_TYPES, AppError(
        422, "bad_audio", "That recording format isn't supported. Hold the button and speak again."))
    if len(data) < MIN_AUDIO_BYTES:
        raise AppError(422, "empty_audio", "Hold the button while speaking.")
    return data, mime, ext


def _voice_note(db, note_id: str, shop_id: str) -> dict:
    check_uuid(note_id, "recording")
    rows = db.table("voice_notes").select("*").eq("id", note_id).limit(1).execute().data
    if not rows or rows[0]["shop_id"] != shop_id or rows[0]["purpose"] != "entry":
        raise not_found("recording")
    return rows[0]


def _respond(db, m: dict, note_id: str, speech_en: str, decision: str, entry: dict | None = None,
             suggestion: str | None = None, transcript: str | None = None, stt_raw: str | None = None) -> dict:
    """Speak the English read-back in the member's voice language, record what was said on the
    voice note (GOAL_2.0 P1.3), and answer the client."""
    speech, audio_b64 = speak(speech_en, m)
    db.table("voice_notes").update({"decision": decision, "speech_text_en": speech_en,
                                    "speech_text_local": speech}).eq("id", note_id).execute()
    return {"decision": decision, "entry": entry, "suggestion": suggestion, "speech_text": speech,
            "speech_text_en": speech_en, "audio_b64": audio_b64, "voice_note_id": note_id,
            "transcript_en": transcript, "stt_raw": stt_raw}


def _save(db, m: dict, user: CurrentUser, parsed: llm_router.ParsedEntry, matches: list[dict],
          note_id: str) -> tuple[llm_router.SaveDecision, dict | None, str | None]:
    """Apply a SaveDecision: insert the entry (confirmed+auto or pending). Returns (decision,
    entry, suggested party id). Clarify inserts nothing."""
    d = llm_router.decide_save(parsed, matches)
    if d.action == "clarify":
        return d, None, None
    kind = party_kind_for(parsed.type)
    party_id, suggested_id = d.party_id, None
    if d.party_action == "ask_did_you_mean":
        # Pending against the suggestion; the card resolves it (YES / NO, NEW PERSON), and a plain
        # CONFIRM in the review queue means yes. No new party is created yet (§12).
        party_id = suggested_id = matches[0]["party_id"]
    elif d.party_action == "create_flagged":
        party_id = get_or_create_party(db, m["shop_id"], parsed.party_name, kind, needs_review=True)
    auto = d.action == "auto"
    row = {"shop_id": m["shop_id"], "party_id": party_id, "type": parsed.type,
           "amount_paise": parsed.amount_paise, "note": parsed.note,
           "expense_category": expense_category(parsed.type, parsed.expense_category),
           "occurred_on": parsed.occurred_on or today_ist().isoformat(),
           "status": "confirmed" if auto else "pending", "source": "voice", "auto_saved": auto,
           "review_reason": d.reason, "voice_note_id": note_id, "created_by": user.id}
    if auto:
        row.update(confirmed_by=user.id, confirmed_at=now_iso())
    entry = fetch_entry(db, db.table("entries").insert(row).execute().data[0]["id"])
    return d, entry, suggested_id


def _party_keyterms(db, shop_id: str) -> list[str]:
    """Up to 50 party names (Sarvam's keyterm limit, 64 chars each), most recently added first."""
    rows = (db.table("parties").select("display_name").eq("shop_id", shop_id)
            .order("created_at", desc=True).limit(50).execute().data)
    return [r["display_name"][:64] for r in rows if r["display_name"].strip()]


def _same_text(a: str, b: str | None) -> bool:
    norm = lambda x: " ".join((x or "").lower().replace("₹", "").split()).strip(" .")  # noqa: E731
    return bool(b) and norm(a) == norm(b)


def _valid_date(iso: str | None) -> str | None:
    """The model's occurred_on is a hint; drop anything that isn't a real ISO date."""
    try:
        return parse_iso_date(iso)
    except AppError:
        return None


@router.post("/voice/entry", dependencies=[Depends(rate_limit("voice"))])
def voice_entry(audio: UploadFile = File(...), answer_to: str | None = Form(None),
                user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id, lang = m["shop_id"], m["lang"]
    db = user_client(user.token)
    data, mime, ext = _read_audio(audio)
    first = _voice_note(db, answer_to, shop_id) if answer_to else None
    if first and ((first.get("parsed") or {}).get("decision") or {}).get("action", "clarify") != "clarify":
        raise AppError(409, "already_answered", "That question was already answered. Hold ADD to start a new entry.")

    path = upload("voice", shop_id, data, mime, ext)
    note = db.table("voice_notes").insert({"shop_id": shop_id, "audio_path": path, "spoken_lang": lang,
                                           "purpose": "entry", "created_by": user.id}).execute().data[0]

    keyterms = _party_keyterms(db, shop_id) if stt_prime_party_names() else None
    heard = sarvam().transcribe_to_english(data, speech_lang(m), mime, f"note.{ext}", keyterms=keyterms)
    transcript = heard.text
    # Stored before anything else happens, so a later failure still leaves what was heard.
    db.table("voice_notes").update({"stt_raw": heard.raw, "transcript_en": transcript}).eq("id", note["id"]).execute()
    silent = llm_router.heard_nothing(transcript)      # GOAL_2.0 P1.6: nothing said → nothing saved
    text = "" if silent else transcript
    if first and not silent:  # §9b: join the question's transcript with the answer and parse them together
        first_text = (first.get("parsed") or {}).get("input_text") or first.get("transcript_en") or ""
        text = f"{first_text} {transcript}".strip()
    parsed = llm_router.parse_entry(text, today_ist().isoformat()) if text else None
    if parsed:
        parsed.occurred_on = _valid_date(parsed.occurred_on)
        if parsed.party_name:
            parsed.party_name = parsed.party_name.strip()
        if parsed.note and _same_text(parsed.note, transcript):
            parsed.note = None   # live check: the parser echoed the whole sentence as the note
        if parsed.type in NO_PARTY_TYPES and parsed.party_name and not parsed.note:
            # Harness run 1: "Paid 2470 for the electricity bill" parsed with party "electricity
            # bill". Expenses and cash entries never take a party, so keep the words as the note.
            parsed.note, parsed.party_name = parsed.party_name, None

    kind = party_kind_for(parsed.type) if parsed else None
    matches: list[dict] = []
    if parsed and not parsed.needs_clarification and parsed.party_name and parsed.type not in NO_PARTY_TYPES:
        matches = db.rpc("find_party", {"p_shop": shop_id, "p_query": parsed.party_name,
                                        "p_kind": kind}).execute().data or []

    if parsed is None:
        d, entry, suggested_id = None, None, None
    else:
        d, entry, suggested_id = _save(db, m, user, parsed, matches, note["id"])
    db.table("voice_notes").update({"parsed": {
        "entry": asdict(parsed) if parsed else None, "input_text": text, "answer_to": answer_to,
        "stt_language_code": heard.language_code, "stt_request_id": heard.request_id,
        "decision": {"action": d.action, "party_action": d.party_action, "suggestion": d.suggestion,
                     "suggested_party_id": suggested_id} if d else None,
    }}).eq("id", note["id"]).execute()

    if parsed is None:
        return _respond(db, m, note["id"], NOT_HEARD, "clarify", transcript=transcript, stt_raw=heard.raw)
    if d.action == "clarify":
        return _respond(db, m, note["id"], d.reason or "How much, and for whom?", "clarify",
                        transcript=transcript, stt_raw=heard.raw)
    name = parsed.party_name if d.party_action == "ask_did_you_mean" else entry.get("party_name")
    return _respond(db, m, note["id"], read_back(parsed, name, d.action, d.suggestion), d.action, entry,
                    d.suggestion, transcript, heard.raw)


class Resolve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    voice_note_id: str
    choice: Literal["use_suggested", "create_new"]


@router.post("/voice/entry/resolve", dependencies=[Depends(rate_limit("voice"))])
def resolve(body: Resolve, user: CurrentUser = Depends(current_user)):
    """Re-run the save decision for a "Did you mean X?" entry with the user's answer."""
    m = require_membership(user)
    db = user_client(user.token)
    note = _voice_note(db, body.voice_note_id, m["shop_id"])
    info = note.get("parsed") or {}
    dec = info.get("decision") or {}
    if dec.get("party_action") != "ask_did_you_mean" or not info.get("entry"):
        raise AppError(409, "nothing_to_resolve", "This recording has no question to answer.")
    rows = (db.table("entries").select("id, status").eq("voice_note_id", note["id"]).limit(1).execute().data)
    if not rows or rows[0]["status"] != "pending":
        raise AppError(409, "already_resolved", "This entry was already confirmed or voided.")
    entry_id = rows[0]["id"]
    e = info["entry"]
    parsed = llm_router.ParsedEntry(e["type"], e["party_name"], e["amount_paise"], e["note"], e["occurred_on"],
                                    False, None, e.get("expense_category"))
    kind = party_kind_for(parsed.type)
    if body.choice == "use_suggested":
        matches = [{"party_id": dec["suggested_party_id"], "display_name": dec["suggestion"], "score": 1.0}]
    else:
        matches = []
    d = llm_router.decide_save(parsed, matches)       # deterministic: party given, amount rule applies
    party_id = d.party_id
    if d.party_action == "create_flagged":
        party_id = get_or_create_party(db, m["shop_id"], parsed.party_name, kind, needs_review=True)
    upd: dict = {"party_id": party_id, "review_reason": d.reason}
    if d.action == "auto":
        upd.update(status="confirmed", auto_saved=True, confirmed_by=user.id, confirmed_at=now_iso())
    db.table("entries").update(upd).eq("id", entry_id).execute()
    entry = fetch_entry(db, entry_id)
    db.table("voice_notes").update({"parsed": {**info, "decision": {**dec, "resolved": body.choice}}}
                                   ).eq("id", note["id"]).execute()
    return _respond(db, m, note["id"], read_back(parsed, entry["party_name"], d.action, None), d.action, entry,
                    None, note.get("transcript_en"), note.get("stt_raw"))


@router.post("/voice/ask", dependencies=[Depends(rate_limit("voice"))])
def voice_ask(audio: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    """CLAUDE.md §6.2: STT (translate) → Groq Q&A with read-only tools → translate back + number
    guard → TTS. shop_id is injected server-side. The recording is kept (voice_notes, purpose
    'question')."""
    m = require_membership(user)
    shop_id, lang = m["shop_id"], m["lang"]
    db = user_client(user.token)
    data, mime, ext = _read_audio(audio)
    path = upload("voice", shop_id, data, mime, ext)
    note = db.table("voice_notes").insert({"shop_id": shop_id, "audio_path": path, "spoken_lang": lang,
                                           "purpose": "question", "created_by": user.id}).execute().data[0]
    today = today_ist()
    r = llm_router.voice_question_pipeline(data, shop_id, m, today.isoformat(), sarvam(),
                                           make_tools(db, today), mime=mime, filename=f"note.{ext}")
    db.table("voice_notes").update({"stt_raw": r.stt_raw, "transcript_en": r.question_en,
                                    "speech_text_en": r.reply_en, "speech_text_local": r.reply_local,
                                    "parsed": {"answer_en": r.reply_en, "stt_language_code": r.stt_language_code}}
                                   ).eq("id", note["id"]).execute()
    return {"text": r.reply_local, "audio_b64": base64.b64encode(r.audio).decode() if r.audio else None,
            "question_en": r.question_en, "stt_raw": r.stt_raw, "voice_note_id": note["id"]}
