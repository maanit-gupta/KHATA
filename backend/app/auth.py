"""Verify Supabase access tokens against the project's JWKS (asymmetric keys, no JWT secret).
PyJWKClient caches the key set, so JWKS is fetched once and refreshed on an unknown `kid`."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Header

from .config import get_settings
from .errors import AppError

ALGORITHMS = ["ES256", "RS256"]


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


def verify_token(token: str) -> dict:
    s = get_settings()
    try:
        key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=ALGORITHMS,
                          audience="authenticated", issuer=s.jwt_issuer,
                          options={"require": ["exp", "sub"]})
    except (jwt.PyJWTError, jwt.PyJWKClientError):
        raise _unauthorized()


def current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    claims = verify_token(token)
    meta = claims.get("user_metadata") or {}
    return CurrentUser(id=claims["sub"], email=claims.get("email"), name=meta.get("name"), token=token)
