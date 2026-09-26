"""POST /tts {text}: speak English text in the caller's language and voice. Like every spoken
line, the text is localized with the number guard first (CLAUDE.md §2, §9b; DECISIONS D-006)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..auth import CurrentUser, current_user
from ..ledger import require_membership
from ..ratelimit import rate_limit
from ..speech import speak

router = APIRouter()


class TtsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2500)


@router.post("/tts", dependencies=[Depends(rate_limit("tts"))])
def tts(body: TtsBody, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    text, audio_b64 = speak(body.text.strip(), m, strict=True)
    return {"text": text, "audio_b64": audio_b64}
