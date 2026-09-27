from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .errors import CatchAllErrors, install_error_handlers
from .routers import entries, insights, ledger, me, media, members, parties, receipts, review, shops, tts, voice

logging.basicConfig(level=logging.INFO)
# httpx logs every request URL at INFO (Supabase filters carry user ids). Keep only warnings.
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="Kirana Ledger API")


class NoStore:
    """Cache-Control: no-store on every API response (GOAL_2.0 P1.2b): a voice or bill result is
    never served from a browser or proxy cache. Pure ASGI, so BackgroundTasks are untouched."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def with_header(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"cache-control", b"no-store")]
            await send(message)
        await self.app(scope, receive, with_header)


app.add_middleware(CatchAllErrors)  # added first = innermost, so its 500s still get CORS headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],   # the CSV export's filename (GOAL_2.0 P3.3)
)
app.add_middleware(NoStore)  # outermost: CORS preflights and 500s carry it too
install_error_handlers(app)


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(me.router)
app.include_router(shops.router)
app.include_router(entries.router)
app.include_router(ledger.router)
app.include_router(members.router)
app.include_router(parties.router)
app.include_router(voice.router)
app.include_router(receipts.router)
app.include_router(review.router)
app.include_router(media.router)
app.include_router(tts.router)
app.include_router(insights.router)
