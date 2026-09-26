"""Creating and joining a shop. These are the only two routes (with Storage) allowed to use the
admin client: RLS has no insert policy on shops/shop_members, and looking up an invite code
means reading a shop the caller is not yet a member of."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, field_validator

from ..auth import CurrentUser, current_user
from ..constants import LANGS
from ..db import PG_UNIQUE_VIOLATION, admin_client
from ..errors import AppError
from .me import MEMBER_COLS, SHOP_COLS, get_membership

router = APIRouter()

INVITE_CODE_RETRIES = 3  # invite_code is random; retry on the rare unique collision


class CreateShop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    lang: Literal[LANGS]  # type: ignore[valid-type]

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name is required")
        return v.strip()


class JoinShop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    lang: Literal[LANGS]  # type: ignore[valid-type]


def _already_in_shop() -> AppError:
    return AppError(409, "already_in_shop", "You already belong to a shop. One account can join only one shop.")


def _add_member(shop_id: str, user_id: str, role: str, lang: str) -> dict:
    try:
        return (admin_client().table("shop_members")
                .insert({"shop_id": shop_id, "user_id": user_id, "role": role, "lang": lang})
                .execute().data[0])
    except APIError as e:
        if e.code == PG_UNIQUE_VIOLATION:  # one_shop_per_user: lost a race with another request
            raise _already_in_shop()
        raise


def _membership_out(row: dict) -> dict:
    return {k: row[k] for k in (c.strip() for c in MEMBER_COLS.split(","))}


def _shop_out(row: dict) -> dict:
    return {k: row[k] for k in (c.strip() for c in SHOP_COLS.split(","))}


@router.post("/shops", status_code=201)
def create_shop(body: CreateShop, user: CurrentUser = Depends(current_user)):
    if get_membership(user):
        raise _already_in_shop()
    admin = admin_client()
    shop = None
    for attempt in range(INVITE_CODE_RETRIES):
        try:
            shop = (admin.table("shops").insert({"name": body.name, "default_lang": body.lang})
                    .execute().data[0])
            break
        except APIError as e:
            if e.code != PG_UNIQUE_VIOLATION or attempt == INVITE_CODE_RETRIES - 1:
                raise
    try:
        member = _add_member(shop["id"], user.id, "owner", body.lang)
    except Exception:
        admin.table("shops").delete().eq("id", shop["id"]).execute()  # don't leave an orphan shop
        raise
    return {"shop": _shop_out(shop), "membership": _membership_out(member)}


@router.post("/shops/join")
def join_shop(body: JoinShop, user: CurrentUser = Depends(current_user)):
    if get_membership(user):
        raise _already_in_shop()
    code = body.code.strip().upper()
    rows = (admin_client().table("shops").select(SHOP_COLS).eq("invite_code", code)
            .limit(1).execute().data) if code else []
    if not rows:
        raise AppError(404, "bad_invite_code", "That invite code doesn't match any shop. Check it with the shop owner.")
    shop = rows[0]
    member = _add_member(shop["id"], user.id, "staff", body.lang)
    return {"shop": _shop_out(shop), "membership": _membership_out(member)}
