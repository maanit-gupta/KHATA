"""Live tests run against the real Supabase project with throwaway users (CLAUDE.md §9b):
each user is created confirmed via the admin API and deleted, with any shop it touched,
in teardown — even when the test fails."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from supabase import ClientOptions, create_client

from app.config import get_settings
from app.db import admin_client
from app.main import app


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


class Users:
    def __init__(self):
        self.user_ids: list[str] = []
        self.shop_ids: set[str] = set()

    def new(self, name: str = "Test User") -> dict:
        email = f"khata-test-{uuid.uuid4().hex[:12]}@example.com"
        password = uuid.uuid4().hex
        created = admin_client().auth.admin.create_user(
            {"email": email, "password": password, "email_confirm": True,
             "user_metadata": {"name": name}})
        self.user_ids.append(created.user.id)
        s = get_settings()
        anon = create_client(s.supabase_url, s.supabase_publishable_key,
                             ClientOptions(auto_refresh_token=False, persist_session=False))
        session = anon.auth.sign_in_with_password({"email": email, "password": password}).session
        return {"id": created.user.id, "email": email, "token": session.access_token,
                "headers": {"Authorization": f"Bearer {session.access_token}"}}

    def track_shop(self, shop_id: str) -> None:
        self.shop_ids.add(shop_id)

    def cleanup(self) -> None:
        admin = admin_client()
        if self.user_ids:  # also catch shops created by a test that failed before tracking
            rows = admin.table("shop_members").select("shop_id").in_("user_id", self.user_ids).execute().data
            self.shop_ids.update(r["shop_id"] for r in rows)
        for shop_id in self.shop_ids:
            admin.table("shops").delete().eq("id", shop_id).execute()  # cascades shop_members
        for uid in self.user_ids:
            admin.auth.admin.delete_user(uid)


@pytest.fixture
def users():
    u = Users()
    try:
        yield u
    finally:
        u.cleanup()
