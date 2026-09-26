"""Test fixtures.

Database: live tests run against the real Supabase project with throwaway users (CLAUDE.md §9b):
each user is created confirmed via the admin API and deleted, with any shop it touched, in
teardown — even when the test fails. audit_log rows reference entries without ON DELETE CASCADE,
so teardown deletes the throwaway shop's audit rows first (DECISIONS.md D-003).

AI services: Sarvam and Groq are ALWAYS fakes here (GOAL.md §1.3). An autouse fixture swaps both
before every test, so an unconfigured call fails loudly instead of spending credits.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient
from supabase import ClientOptions, create_client

from app.config import get_settings
from app.db import admin_client
from app.main import app
from app import ratelimit
from app.services import llm_router, receipt_ocr, retry
from app.services import sarvam as sarvam_service


def api_routes() -> set[tuple[str, str]]:
    """Every (method, path) the app serves. FastAPI 0.141 wraps included routers in
    `_IncludedRouter`, so walk `original_router` instead of trusting `app.routes`."""
    from fastapi.routing import APIRoute

    def walk(routes):
        for r in routes:
            if isinstance(r, APIRoute):
                yield r
            elif hasattr(r, "original_router"):
                yield from walk(r.original_router.routes)
    return {(m, r.path) for r in walk(app.routes) for m in r.methods}


def api_route_objects():
    from fastapi.routing import APIRoute

    def walk(routes):
        for r in routes:
            if isinstance(r, APIRoute):
                yield r
            elif hasattr(r, "original_router"):
                yield from walk(r.original_router.routes)
    return list(walk(app.routes))


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------------------------
# Throwaway users and shops
# ---------------------------------------------------------------------------------------------
class Users:
    def __init__(self, client: TestClient | None = None):
        self.user_ids: list[str] = []
        self.shop_ids: set[str] = set()
        self.client = client

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

    def with_shop(self, name: str = "Test Shop", lang: str = "en-IN", user_name: str = "Test User") -> dict:
        """A new user who owns a new shop. Returns the user dict plus shop_id / invite_code."""
        u = self.new(user_name)
        resp = self.client.post("/shops", json={"name": name, "lang": lang}, headers=u["headers"])
        assert resp.status_code == 201, resp.text
        shop = resp.json()["shop"]
        self.track_shop(shop["id"])
        return {**u, "shop_id": shop["id"], "invite_code": shop["invite_code"], "lang": lang}

    def join(self, owner: dict, lang: str = "en-IN") -> dict:
        u = self.new("Staff")
        resp = self.client.post("/shops/join", json={"code": owner["invite_code"], "lang": lang},
                                headers=u["headers"])
        assert resp.status_code == 200, resp.text
        return {**u, "shop_id": owner["shop_id"], "lang": lang}

    def track_shop(self, shop_id: str) -> None:
        self.shop_ids.add(shop_id)

    def cleanup(self) -> None:
        admin = admin_client()
        errors: list[str] = []
        if self.user_ids:  # also catch shops created by a test that failed before tracking
            rows = admin.table("shop_members").select("shop_id").in_("user_id", self.user_ids).execute().data
            self.shop_ids.update(r["shop_id"] for r in rows)
        for shop_id in self.shop_ids:
            try:
                for bucket in ("voice", "receipts"):
                    files = admin.storage.from_(bucket).list(shop_id) or []
                    paths = [f"{shop_id}/{f['name']}" for f in files if f.get("name")]
                    if paths:
                        admin.storage.from_(bucket).remove(paths)
                admin.table("audit_log").delete().eq("shop_id", shop_id).execute()
                admin.table("shops").delete().eq("id", shop_id).execute()  # cascades the rest
            except Exception as e:  # keep going so users are still deleted
                errors.append(f"shop {shop_id}: {e}")
        for uid in self.user_ids:
            try:
                admin.auth.admin.delete_user(uid)
            except Exception as e:
                errors.append(f"user {uid}: {e}")
        assert not errors, errors


@pytest.fixture
def users(client):
    u = Users(client)
    try:
        yield u
    finally:
        u.cleanup()


# ---------------------------------------------------------------------------------------------
# Fake Sarvam and Groq
# ---------------------------------------------------------------------------------------------
class FakeSarvam:
    """Implements the adapter surface the app uses. Records every call in `calls`."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.transcripts: list[str] = []
        self.translate_fn: Callable[[str, str], str] = lambda text, tgt: f"[{tgt}] {text}"
        self.fail: dict[str, Exception] = {}
        self.doc_jobs: list[dict] = []
        self.keyterms: list = []
        self.jobs: dict[str, dict] = {}

    def _maybe_fail(self, what: str) -> None:
        if what in self.fail:
            raise self.fail[what]

    def transcribe_to_english(self, audio: bytes, lang: str, mime: str = "audio/webm",
                              filename: str = "note.webm", keyterms: list[str] | None = None) -> str:
        self.calls.append(("stt", lang, mime, filename))
        self.keyterms.append(keyterms)
        self._maybe_fail("stt")
        assert self.transcripts, "test did not queue a transcript"
        return self.transcripts.pop(0)

    def translate(self, text: str, src: str, tgt: str) -> str:
        self.calls.append(("translate", text, src, tgt))
        self._maybe_fail("translate")
        return self.translate_fn(text, tgt)

    def speak(self, text: str, lang: str, voice: str | None) -> bytes:
        self.calls.append(("tts", text, lang, voice))
        self._maybe_fail("tts")
        return b"ID3-fake-mp3"

    # --- Document AI: each *_start call consumes the next scripted job from doc_jobs ---------
    # A job: {"statuses": [...polled in order, last repeats], "results": {...}} or {"start_error": exc}
    def _start(self, kind: str, lang: str) -> str:
        self.calls.append((f"doc_{kind}", lang))
        assert self.doc_jobs, f"test did not script a Document AI {kind} job"
        job = self.doc_jobs.pop(0)
        if "start_error" in job:
            raise job["start_error"]
        job_id = f"job-{len(self.jobs) + 1}"
        self.jobs[job_id] = {**job, "polls": list(job.get("statuses", ["pending", "completed"]))}
        return job_id

    def doc_extract_start(self, image, filename, mime, lang, schema_json):
        return self._start("extract", lang)

    def doc_digitise_start(self, image, filename, mime, lang):
        return self._start("digitise", lang)

    def doc_status(self, job_id: str) -> str:
        self.calls.append(("doc_status", job_id))
        polls = self.jobs[job_id]["polls"]
        return polls.pop(0) if len(polls) > 1 else polls[0]

    def doc_results(self, job_id: str) -> dict:
        self.calls.append(("doc_results", job_id))
        return self.jobs[job_id]["results"]

    def count(self, kind: str) -> int:
        return sum(1 for c in self.calls if c[0] == kind)


def _response(content: str | None = None, tool_calls: list | None = None) -> Any:
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def tool_call(name: str, args: dict, call_id: str | None = None) -> Any:
    cid = call_id or f"call_{uuid.uuid4().hex[:8]}"
    fn = SimpleNamespace(name=name, arguments=json.dumps(args))
    tc = SimpleNamespace(id=cid, type="function", function=fn)
    tc.model_dump = lambda: {"id": cid, "type": "function",
                             "function": {"name": name, "arguments": json.dumps(args)}}
    return tc


class FakeGroq:
    """Stands in for groq.Groq: .chat.completions.create(**kwargs). `handler(kwargs)` returns a
    response; helpers build the common ones. Every call is recorded in `calls`."""

    def __init__(self):
        self.calls: list[dict] = []
        self.handler: Callable[[dict], Any] | None = None
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        assert self.handler, "test did not configure a Groq response"
        return self.handler(kwargs)

    # --- helpers ---
    def parse_returns(self, *entries: dict) -> None:
        """Queue parse_entry results (the model's JSON)."""
        queue = list(entries)

        def handler(kwargs):
            full = {"type": "credit_given", "party_name": None, "amount_rupees": None, "note": None,
                    "occurred_on": None, "needs_clarification": False, "clarification_question": None}
            full.update(queue.pop(0))
            return _response(json.dumps(full))
        self.handler = handler

    def script(self, *responses: Any) -> None:
        """Return these responses in order (use text()/tools())."""
        queue = list(responses)
        self.handler = lambda kwargs: queue.pop(0)

    @staticmethod
    def text(content: str) -> Any:
        return _response(content)

    @staticmethod
    def tools(*calls: Any) -> Any:
        return _response("", list(calls))


@pytest.fixture(autouse=True)
def fake_ai(monkeypatch):
    ratelimit.reset()   # every test starts with full per-user buckets
    fs, fg = FakeSarvam(), FakeGroq()
    monkeypatch.setattr(sarvam_service, "_client", fs)
    monkeypatch.setattr(llm_router, "groq", fg)
    sleeps: list[float] = []
    monkeypatch.setattr(retry, "sleep", sleeps.append)
    # Receipt polling runs on a fake clock: each sleep advances it, nothing actually waits.
    clock = SimpleNamespace(t=0.0, polls=[])

    def fake_sleep(s: float) -> None:
        clock.polls.append(s)
        clock.t += s
    monkeypatch.setattr(receipt_ocr, "sleep", fake_sleep)
    monkeypatch.setattr(receipt_ocr, "clock", lambda: clock.t)
    return SimpleNamespace(sarvam=fs, groq=fg, sleeps=sleeps, clock=clock)


@pytest.fixture
def fake_sarvam(fake_ai) -> FakeSarvam:
    return fake_ai.sarvam


@pytest.fixture
def fake_groq(fake_ai) -> FakeGroq:
    return fake_ai.groq


# A tiny but non-empty WebM-looking payload (the endpoint rejects < 1000 bytes as empty).
AUDIO = b"\x1aE\xdf\xa3" + b"\x00" * 2048


def post_audio(client, path: str, headers: dict, mime: str = "audio/webm", data: bytes = AUDIO):
    ext = "mp4" if "mp4" in mime else "webm"
    return client.post(path, files={"audio": (f"note.{ext}", data, mime)}, headers=headers)
