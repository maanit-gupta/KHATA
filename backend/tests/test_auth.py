import time

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import get_settings


def _assert_unauthorized(resp):
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


def test_health_needs_no_token(client):
    assert client.get("/health").json() == {"ok": True}


def test_missing_token_rejected(client):
    _assert_unauthorized(client.get("/me"))


def test_non_bearer_header_rejected(client):
    _assert_unauthorized(client.get("/me", headers={"Authorization": "Basic abc"}))


def test_garbage_token_rejected(client):
    _assert_unauthorized(client.get("/me", headers={"Authorization": "Bearer not-a-jwt"}))


def test_token_signed_with_foreign_key_rejected(client):
    """Correct shape and claims, but signed by a key that isn't in the project's JWKS."""
    s = get_settings()
    now = int(time.time())
    forged = jwt.encode(
        {"sub": "00000000-0000-0000-0000-000000000000", "aud": "authenticated",
         "iss": s.jwt_issuer, "iat": now, "exp": now + 600, "role": "authenticated"},
        ec.generate_private_key(ec.SECP256R1()), algorithm="ES256",
        headers={"kid": "not-a-real-kid"})
    _assert_unauthorized(client.get("/me", headers={"Authorization": f"Bearer {forged}"}))


def test_real_token_accepted(client, users):
    u = users.new("Asha")
    resp = client.get("/me", headers=u["headers"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"] == {"id": u["id"], "email": u["email"], "name": "Asha"}
    assert body["membership"] is None and body["shop"] is None  # -> onboarding


def _local_signed(claims_delta: dict, monkeypatch):
    """A token signed by a key we control, with the JWKS lookup pointed at that key."""
    from types import SimpleNamespace

    from app import auth
    s = get_settings()
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "_jwks_client",
                        lambda: SimpleNamespace(get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=key.public_key())))
    now = int(time.time())
    claims = {"sub": "00000000-0000-0000-0000-000000000001", "aud": "authenticated", "iss": s.jwt_issuer,
              "iat": now, "exp": now + 600, "role": "authenticated", **claims_delta(now)}
    return jwt.encode(claims, key, algorithm="ES256", headers={"kid": "local"})


def test_small_clock_skew_is_tolerated(monkeypatch):
    """Regression (D-043): Supabase's clock a second or two ahead of ours must not log users out."""
    from app.auth import verify_token
    token = _local_signed(lambda now: {"iat": now + 2}, monkeypatch)
    assert verify_token(token)["sub"].endswith("1")


def test_large_clock_skew_and_expiry_are_refused(monkeypatch):
    from app.auth import verify_token
    from app.errors import AppError
    import pytest
    for delta in (lambda now: {"iat": now + 3600}, lambda now: {"exp": now - 120}):
        with pytest.raises(AppError):
            verify_token(_local_signed(delta, monkeypatch))
