from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, field_validator

from ..auth import CurrentUser, current_user
from ..constants import LANGS, VOICES
from ..db import user_client
from ..errors import AppError

router = APIRouter()

MEMBER_COLS = "shop_id, role, lang, tts_voice, joined_at"
SHOP_COLS = "id, name, default_lang, invite_code, created_at"


def get_membership(user: CurrentUser) -> dict | None:
    rows = (user_client(user.token).table("shop_members").select(MEMBER_COLS)
            .eq("user_id", user.id).limit(1).execute().data)
    return rows[0] if rows else None


@router.get("/me")
def read_me(user: CurrentUser = Depends(current_user)):
    membership = get_membership(user)
    shop = None
    if membership:
        rows = (user_client(user.token).table("shops").select(SHOP_COLS)
                .eq("id", membership["shop_id"]).limit(1).execute().data)
        shop = rows[0] if rows else None
    return {"user": {"id": user.id, "email": user.email, "name": user.name},
            "membership": membership, "shop": shop}


class MePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lang: Literal[LANGS] | None = None  # type: ignore[valid-type]
    tts_voice: str | None = None

    @field_validator("tts_voice")
    @classmethod
    def known_voice(cls, v: str | None) -> str | None:
        if v is not None and v not in VOICES:
            raise ValueError("unknown voice")
        return v


@router.patch("/me")
def update_me(body: MePatch, user: CurrentUser = Depends(current_user)):
    changes = body.model_dump(exclude_unset=True)
    if not get_membership(user):
        raise AppError(409, "no_shop", "Create or join a shop first.")
    if changes:
        # member_self RLS policy allows this; the tamper trigger blocks shop_id/user_id/role.
        user_client(user.token).table("shop_members").update(changes).eq("user_id", user.id).execute()
    return get_membership(user)
