from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .errors import install_error_handlers
from .routers import entries, me, parties, shops, voice

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Kirana Ledger API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
install_error_handlers(app)


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(me.router)
app.include_router(shops.router)
app.include_router(entries.router)
app.include_router(parties.router)
app.include_router(voice.router)
