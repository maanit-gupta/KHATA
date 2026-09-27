"""POST /tts {text, purpose?}: speak English text in the caller's voice. Like every spoken line, the
text is localized with the number guard first (CLAUDE.md §2, §9b; DECISIONS D-006). A read-back or
sample speaks in the voice language; `purpose: "report"` (the weekly summary, tips, the briefing)
speaks in the report language (GOAL_2.0 P5.3)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..auth import CurrentUser, current_user
from ..langs import report_lang, voice_lang
from ..ledger import require_membership
from ..ratelimit import rate_limit
from ..speech import speak

router = APIRouter()


class TtsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2500)
    purpose: Literal["readback", "report"] = "readback"


@router.post("/tts", dependencies=[Depends(rate_limit("tts"))])
def tts(body: TtsBody, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    lang = report_lang(m) if body.purpose == "report" else voice_lang(m)
    text, audio_b64 = speak(body.text.strip(), m, strict=True, lang=lang)
    return {"text": text, "audio_b64": audio_b64}
