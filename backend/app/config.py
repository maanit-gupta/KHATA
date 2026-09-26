"""Settings from the environment. Locally, backend/.env is read first (it never overrides
variables that are already set, so Render's dashboard env always wins)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_env_file(ENV_FILE)  # at import, so SDK clients created at import (Groq) see the keys


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_publishable_key: str
    supabase_secret_key: str
    allowed_origins: list[str]

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    _load_env_file(ENV_FILE)
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY")
               if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")
    origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return Settings(
        supabase_url=os.environ["SUPABASE_URL"].rstrip("/"),
        supabase_publishable_key=os.environ["SUPABASE_PUBLISHABLE_KEY"],
        supabase_secret_key=os.environ["SUPABASE_SECRET_KEY"],
        allowed_origins=origins,
    )
