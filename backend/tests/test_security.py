"""P8.5 security sweep: CORS, where the secret key is used, logging hygiene, upload limits
(see test_receipts/test_voice_entry), and per-user rate limits (D-037)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.config import get_settings
from app.main import app
from tests.conftest import api_route_objects

APP = Path(__file__).resolve().parent.parent / "app"


@pytest.fixture(autouse=True)
def fresh_buckets():
    ratelimit.reset()
    yield
    ratelimit.reset()


def test_cors_allows_only_configured_origins(client):
    allowed = get_settings().allowed_origins
    assert allowed, "ALLOWED_ORIGINS must be set"
    ok = client.options("/me", headers={"Origin": allowed[0], "Access-Control-Request-Method": "GET",
                                        "Access-Control-Request-Headers": "authorization"})
    assert ok.headers.get("access-control-allow-origin") == allowed[0]
    evil = client.options("/me", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in evil.headers
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": "https://evil.example"}).headers
    assert get_settings().allowed_origins != ["*"]


def test_unhandled_errors_keep_cors_and_error_shape():
    def boom():
        raise RuntimeError("secret-looking detail sb_secret_xyz")
    app.add_api_route("/__boom", boom)
    try:
        c = TestClient(app, raise_server_exceptions=False)
        origin = get_settings().allowed_origins[0]
        r = c.get("/__boom", headers={"Origin": origin})
        assert r.status_code == 500
        assert r.json() == {"error": {"code": "server_error", "message": "Something went wrong on our side. Try again."}}
        assert r.headers.get("access-control-allow-origin") == origin   # the browser can read it
        assert "sb_secret" not in r.text
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/__boom"]


def test_secret_key_only_where_claude_md_allows():
    """CLAUDE.md §3/§10: the secret key (admin_client) only for POST /shops, POST /shops/join and
    Storage. Tests and scripts may use it for setup/teardown."""
    users = sorted(p.relative_to(APP).as_posix() for p in APP.rglob("*.py")
                   if "admin_client" in p.read_text() and p.name != "db.py")
    assert users == ["routers/shops.py", "storage.py"]


def test_no_secret_or_token_logging():
    bad = re.compile(r"(print\(|log\.\w+\(.*(token|secret|authorization|api_key|password))", re.I)
    hits = [f"{p.name}:{i}" for p in APP.rglob("*.py")
            for i, line in enumerate(p.read_text().splitlines(), 1) if bad.search(line.split("#")[0])]
    assert hits == []


def test_expensive_routes_are_rate_limited():
    limited = {(m, r.path) for r in api_route_objects()
               for m in r.methods
               if any(getattr(d.call, "__name__", "").startswith("rate_limit_") for d in r.dependant.dependencies)}
    assert limited == {("POST", "/voice/entry"), ("POST", "/voice/entry/resolve"), ("POST", "/voice/ask"),
                       ("POST", "/receipts"), ("POST", "/tts")}


def test_token_bucket_refills(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(ratelimit, "clock", lambda: t["now"])
    assert all(ratelimit.take("tts", "u1") for _ in range(10))
    assert not ratelimit.take("tts", "u1")            # burst used up
    assert ratelimit.take("tts", "u2")                # per user
    t["now"] += 6.0                                    # 10/min → one token back after 6 s
    assert ratelimit.take("tts", "u1") and not ratelimit.take("tts", "u1")


def test_rate_limit_answers_429_with_plain_message(client, users, monkeypatch, fake_sarvam):
    monkeypatch.setattr(ratelimit, "clock", lambda: 5000.0)
    u = users.with_shop()
    codes = [client.post("/tts", json={"text": "hello"}, headers=u["headers"]).status_code for _ in range(11)]
    assert codes == [200] * 10 + [429]
    r = client.post("/tts", json={"text": "hello"}, headers=u["headers"])
    assert r.json() == {"error": {"code": "rate_limited", "message": "Too many requests. Wait a minute, then try again."}}
    assert fake_sarvam.count("tts") == 10
