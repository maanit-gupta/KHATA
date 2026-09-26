"""Verify Supabase access tokens against the project's JWKS (asymmetric keys, no JWT secret).
PyJWKClient caches the key set, so JWKS is fetched once and refreshed on an unknown `kid`."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Header

from .config import get_settings
from .errors import AppError

log = logging.getLogger("khata")

ALGORITHMS = ["ES256", "RS256"]
# Supabase's clock and ours are never exactly equal. `iat` is a whole second, so without leeway a
# token used within a second of login can look issued "in the future" and be refused (D-043).
CLOCK_LEEWAY_S = 30


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    name: str | None
    token: str  # raw access token, forwarded to Supabase so RLS applies


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=3600, timeout=10)


def _unauthorized() -> AppError:
    return AppError(401, "unauthorized", "Your session has ended. Log in again.")


def _signing_key(token: str):
    """The token's key from the (cached) JWKS. A network failure fetching the JWKS is retried once
    and then reported as "try again" (503), never as a logout: a blip must not end a session."""
    for attempt in (1, 2):
        try:
            return _jwks_client().get_signing_key_from_jwt(token)
        except jwt.PyJWKClientConnectionError as e:
            log.warning("JWKS fetch failed (attempt %d): %s", attempt, type(e).__name__)
            if attempt == 2:
                raise AppError(503, "auth_unavailable", "Couldn't check your login right now. Try again.") from e
            time.sleep(0.5)


def verify_token(token: str) -> dict:
    s = get_settings()
    try:
        key = _signing_key(token)
        return jwt.decode(token, key.key, algorithms=ALGORITHMS,
                          audience="authenticated", issuer=s.jwt_issuer, leeway=CLOCK_LEEWAY_S,
                          options={"require": ["exp", "sub"]})
    except (jwt.PyJWTError, jwt.PyJWKClientError) as e:
        log.info("token refused: %s", type(e).__name__)   # the reason, never the token
        raise _unauthorized()


def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    claims = verify_token(token)
    meta = claims.get("user_metadata") or {}
    return CurrentUser(id=claims["sub"], email=claims.get("email"), name=meta.get("name"), token=token)
