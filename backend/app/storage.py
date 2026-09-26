"""Private Storage (CLAUDE.md §9, §10). Uploads and signed URLs use the secret key, so every call
here first proves the caller belongs to the shop in the path: the path always starts with the
caller's own shop_id (from their RLS-checked membership), and reads look the row up with the
user-scoped client before signing."""

from __future__ import annotations

import uuid

from fastapi import UploadFile

from .db import admin_client
from .errors import AppError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # GOAL.md P8.5
SIGNED_URL_SECONDS = 600             # 10 minutes (CLAUDE.md §9)

AUDIO_TYPES = {"audio/webm": "webm", "audio/mp4": "mp4", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
               "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
               "audio/ogg": "ogg"}
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png"}


def read_upload(file: UploadFile, allowed: dict[str, str], wrong_type: AppError) -> tuple[bytes, str, str]:
    """Returns (bytes, mime, ext). Enforces the MIME allow-list and the 10 MB cap server-side."""
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in allowed:
        raise wrong_type
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError(413, "too_large", "That file is over 10 MB. Use a smaller photo or a shorter recording.")
    return data, mime, allowed[mime]


def upload(bucket: str, shop_id: str, data: bytes, mime: str, ext: str) -> str:
    path = f"{shop_id}/{uuid.uuid4()}.{ext}"
    admin_client().storage.from_(bucket).upload(path, data, {"content-type": mime})
    return path


def signed_url(bucket: str, path: str, shop_id: str) -> str:
    if not path.startswith(f"{shop_id}/"):
        raise AppError(404, "not_found", "That file does not exist.")
    res = admin_client().storage.from_(bucket).create_signed_url(path, SIGNED_URL_SECONDS)
    url = res.get("signedURL") or res.get("signedUrl") if isinstance(res, dict) else getattr(res, "signed_url", None)
    if not url:
        raise AppError(404, "not_found", "That file does not exist.")
    return url
