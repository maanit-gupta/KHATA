"""Supabase clients.

user_client(): publishable key + the caller's access token. RLS applies and the audit trigger
records auth.uid(). Use this for everything by default.

admin_client(): secret key, bypasses RLS. Allowed ONLY for POST /shops, POST /shops/join and
Storage (CLAUDE.md §3, §10). Never return it to the frontend and never log it.
"""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, ClientOptions, create_client

from .config import get_settings

PG_UNIQUE_VIOLATION = "23505"
# A hung database call should become a clean error, not a stuck worker (default is 120 s).
DB_TIMEOUT_S = 30


def user_client(token: str) -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_publishable_key,
                         ClientOptions(headers={"Authorization": f"Bearer {token}"},
                                       auto_refresh_token=False, persist_session=False,
                                       postgrest_client_timeout=DB_TIMEOUT_S))


@lru_cache
def admin_client() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_secret_key,
                         ClientOptions(auto_refresh_token=False, persist_session=False,
                                       postgrest_client_timeout=DB_TIMEOUT_S))
