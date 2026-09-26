"""GET /media/{voice|receipts}/{id}: a 10-minute signed URL for a voice note's audio or a
receipt's image (CLAUDE.md §9). The row is read with the user-scoped client, so RLS proves the
caller is a member of its shop before the secret key signs anything."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..ledger import check_uuid, not_found, require_membership
from ..storage import signed_url

router = APIRouter()

SOURCES = {"voice": ("voice_notes", "audio_path", "recording"), "receipts": ("receipts", "image_path", "bill photo")}


@router.get("/media/{bucket}/{item_id}")
def media(bucket: Literal["voice", "receipts"], item_id: str, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    table, column, what = SOURCES[bucket]
    check_uuid(item_id, what)
    rows = user_client(user.token).table(table).select(f"{column}, shop_id").eq("id", item_id).limit(1).execute().data
    if not rows or rows[0]["shop_id"] != m["shop_id"]:
        raise not_found(what)
    return {"url": signed_url(bucket, rows[0][column], m["shop_id"])}
