"""POST /voice/entry: audio -> Storage -> STT (translate) -> parse_entry -> find_party -> decide_save."""

from __future__ import annotations

import base64
import logging
import uuid
from functools import lru_cache

from fastapi import APIRouter, Depends, File, UploadFile

from ..auth import CurrentUser, current_user
from ..db import admin_client, user_client
from ..errors import AppError
from ..ledger import (NO_PARTY_TYPES, now_iso, party_kind_for, require_membership, today_ist)
from ..services import llm_router
from ..services.sarvam import Sarvam
from .entries import fetch_entry

log = logging.getLogger("khata")
router = APIRouter()

TYPE_WORDS = {"credit_given": "udhaar given", "payment_received": "payment received",
              "cash_sale": "cash sale", "purchase_credit": "purchase on credit",
              "purchase_paid": "purchase paid", "payment_made": "payment made", "expense": "expense"}
EXT = {"audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav",
       "audio/x-wav": "wav", "audio/ogg": "ogg"}


@lru_cache
def sarvam() -> Sarvam:
    return Sarvam()


def _rupees(paise: int) -> str:
    return str(paise // 100) if paise % 100 == 0 else f"{paise / 100:.2f}"


def _speak(text_en: str, member: dict) -> tuple[str, str | None]:
    """Localize (translate + number guard) then TTS. A TTS failure never undoes a save."""
    try:
        local = llm_router.localize_for_speech(text_en, member["lang"], sarvam())
        audio = sarvam().speak(local, member["lang"], member.get("tts_voice"))
        return local, base64.b64encode(audio).decode()
    except Exception:
        log.exception("tts failed")
        return text_en, None


@router.post("/voice/entry")
def voice_entry(audio: UploadFile = File(...), user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    shop_id, lang = m["shop_id"], m["lang"]
    db = user_client(user.token)
    data = audio.file.read()
    if len(data) < 1000:  # an empty WebM container is ~100 bytes
        raise AppError(422, "empty_audio", "Hold the button while speaking.")
    mime = (audio.content_type or "audio/webm").split(";")[0]
    ext = EXT.get(mime, "webm")
    path = f"{shop_id}/{uuid.uuid4()}.{ext}"
    admin_client().storage.from_("voice").upload(path, data, {"content-type": mime})
    note = db.table("voice_notes").insert({"shop_id": shop_id, "audio_path": path, "spoken_lang": lang,
                                           "purpose": "entry", "created_by": user.id}).execute().data[0]

    transcript = sarvam().transcribe_to_english(data, lang, mime, f"note.{ext}")
    today = today_ist().isoformat()
    parsed = llm_router.parse_entry(transcript, today) if transcript else None
    db.table("voice_notes").update({"transcript_en": transcript,
                                    "parsed": parsed.__dict__ if parsed else None}).eq("id", note["id"]).execute()

    base = {"voice_note_id": note["id"], "transcript_en": transcript}
    if parsed is None:
        speech, audio_b64 = _speak("I did not hear anything. Please try again.", m)
        return {**base, "decision": "clarify", "entry": None, "suggestion": None,
                "speech_text": speech, "audio_b64": audio_b64}

    kind = party_kind_for(parsed.type)
    matches = []
    if parsed.party_name and parsed.type not in NO_PARTY_TYPES:
        matches = db.rpc("find_party", {"p_shop": shop_id, "p_query": parsed.party_name,
                                        "p_kind": kind}).execute().data or []
    d = llm_router.decide_save(parsed, matches)

    if d.action == "clarify":
        speech, audio_b64 = _speak(d.reason or "Please say that again.", m)
        return {**base, "decision": "clarify", "entry": None, "suggestion": None,
                "speech_text": speech, "audio_b64": audio_b64}

    party_id = d.party_id
    if d.party_action == "ask_did_you_mean":
        party_id = matches[0]["party_id"]  # pending with the suggestion; CONFIRM = yes
    elif d.party_action == "create_flagged":
        name = parsed.party_name.strip()
        party_id = db.table("parties").insert({"shop_id": shop_id, "kind": kind, "display_name": name,
                                               "name_latin": name.lower(), "needs_review": True}
                                              ).execute().data[0]["id"]

    auto = d.action == "auto"
    row = {"shop_id": shop_id, "party_id": party_id, "type": parsed.type,
           "amount_paise": parsed.amount_paise, "note": parsed.note,
           "occurred_on": parsed.occurred_on or today, "status": "confirmed" if auto else "pending",
           "source": "voice", "auto_saved": auto, "review_reason": d.reason,
           "voice_note_id": note["id"], "created_by": user.id}
    if auto:
        row.update(confirmed_by=user.id, confirmed_at=now_iso())
    entry = fetch_entry(db, db.table("entries").insert(row).execute().data[0]["id"])

    name = parsed.party_name if d.party_action == "ask_did_you_mean" else entry.get("party_name")
    who = f"{name}, " if name else ""
    said = f"{who}{_rupees(parsed.amount_paise)} rupees {TYPE_WORDS[parsed.type]}"
    if auto:
        speech_en = f"{said}, saved."
    elif d.party_action == "ask_did_you_mean":
        speech_en = f"{said}. Did you mean {d.suggestion}? Tap confirm to save."
    else:
        speech_en = f"{said}. Tap confirm to save."
    speech, audio_b64 = _speak(speech_en, m)
    return {**base, "decision": d.action, "entry": entry, "suggestion": d.suggestion,
            "speech_text": speech, "audio_b64": audio_b64}
