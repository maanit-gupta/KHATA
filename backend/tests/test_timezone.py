"""P1.5: every date is Asia/Kolkata (CLAUDE.md §9b). 23:30 UTC on 26 Sep is 05:00 IST on 27 Sep."""

import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app import ledger
from tests.conftest import post_audio

LATE_UTC = datetime(2026, 9, 26, 23, 30, tzinfo=timezone.utc)


@pytest.fixture
def late_night(monkeypatch):
    monkeypatch.setattr(ledger, "now_ist", lambda: LATE_UTC.astimezone(ZoneInfo("Asia/Kolkata")))


def test_today_is_ist(late_night):
    assert ledger.today_ist().isoformat() == "2026-09-27"
    assert ledger.now_iso().endswith("+05:30")


def test_voice_entry_at_2330_utc_lands_on_next_ist_day(client, users, fake_sarvam, fake_groq, late_night):
    u = users.with_shop()
    fake_sarvam.transcripts.append("Ramesh took 250 on credit")
    fake_groq.parse_returns({"type": "credit_given", "party_name": "Ramesh", "amount_rupees": 250})
    r = post_audio(client, "/voice/entry", u["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["entry"]["occurred_on"] == "2026-09-27"
    system_prompt = fake_groq.calls[0]["messages"][0]["content"]
    assert "Today is 2026-09-27." in system_prompt  # "today" sent to the LLM is IST


def test_manual_entry_default_date_is_ist(client, users, late_night):
    u = users.with_shop()
    r = client.post("/entries", json={"type": "cash_sale", "amount_rupees": 10}, headers=u["headers"])
    assert r.json()["occurred_on"] == "2026-09-27"


def test_no_naive_clock_in_backend():
    """grep proof: the only clock is ledger.now_ist()."""
    app_dir = Path(__file__).resolve().parent.parent / "app"
    bad = re.compile(r"utcnow\(|date\.today\(|datetime\.now\(\s*\)|datetime\.today\(|time\.localtime\(")
    hits = [f"{p.name}:{i}" for p in app_dir.rglob("*.py")
            for i, line in enumerate(p.read_text().splitlines(), 1) if bad.search(line)]
    assert hits == []
