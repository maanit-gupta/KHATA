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
# Bills: photos, or a PDF (Document AI reads PDFs natively; GOAL_2.0 P2.1, D-056).
BILL_TYPES = {**IMAGE_TYPES, "application/pdf": "pdf"}
MAX_PDF_PAGES = 1


def pdf_pages(data: bytes) -> int | None:
    """Page count of a PDF from its page objects; None when they are hidden in compressed object
    streams (then Document AI's own 10-page limit applies)."""
    import re
    n = len(re.findall(rb"/Type\s*/Page(?!s)", data))
    return n or None


def sniff(data: bytes) -> str | None:
    """MIME from magic bytes, for uploads whose Content-Type is missing or generic
    (some browsers send a Blob as application/octet-stream)."""
    if data[:4] == b"\x1aE\xdf\xa3":
        return "audio/webm"
    if data[4:8] == b"ftyp":
        return "audio/mp4"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return None


def read_upload(file: UploadFile, allowed: dict[str, str], wrong_type: AppError) -> tuple[bytes, str, str]:
    """Returns (bytes, mime, ext). Enforces the MIME allow-list and the 10 MB cap server-side.
    A declared type outside the list is refused; a missing/generic one is sniffed from the bytes.
    When the bytes clearly say otherwise (Safari can label an MP4 recording audio/webm), the
    bytes win, so Sarvam is always told the real container (GOAL_2.0 P1.2f). Bytes are never
    converted or re-encoded."""
    declared = (file.content_type or "").split(";")[0].strip().lower()
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError(413, "too_large", "That file is over 10 MB. Use a smaller photo or a shorter recording.")
    sniffed = sniff(data)
    mime = declared if declared in allowed else None
    if mime is None and declared in ("", "application/octet-stream"):
        mime = sniffed
    if mime is None:
        raise wrong_type
    if sniffed in allowed and allowed[sniffed] != allowed[mime]:
        mime = sniffed
    if mime not in allowed:
        raise wrong_type
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
