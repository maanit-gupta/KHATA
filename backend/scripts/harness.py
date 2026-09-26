"""Real-material harness (GOAL_2.0 P1.4).

Runs voice recordings and bill photos through the EXACT production code path: the FastAPI app
itself (POST /voice/entry, POST /receipts + its BackgroundTask, GET /receipts/{id}), with live
Sarvam and Groq, as throwaway users in a throwaway shop that is deleted afterwards. Writes
artifacts/harness/report.md (+ results.json, and every TTS read-back as an MP3).

Material, in priority order:
  test-material/voice/*.webm|mp3|m4a|wav + expected.csv  (file,lang,what_was_said,expected_type,expected_party,expected_amount)
  test-material/bills/*.jpg|png          + expected.csv  (file,kind,vendor,date,total)
If either folder is missing or empty, a SYNTHETIC set is used instead (labelled so in the report):
6 clips spoken by Sarvam TTS in 3 languages and 3 bills rendered by Chromium, all with names and
amounts that appear nowhere else in the repo. Generated material is cached in
artifacts/harness/synthetic/, so a re-run doesn't pay for the clips again.

Usage (from the repo root):
  backend/.venv/bin/python backend/scripts/harness.py [--max-sarvam 90] [--max-groq 40]
      [--only voice|bills] [--keep FILE]      # --keep: leave the shop for UI screenshots; FILE gets the login
  backend/.venv/bin/python backend/scripts/harness.py --cleanup FILE
"""

from __future__ import annotations

import argparse
import base64
import csv
import difflib
import json
import os
import random
import re
import subprocess
import sys
import time
import uuid
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from supabase import ClientOptions, create_client  # noqa: E402

from app import ratelimit  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import admin_client  # noqa: E402
from app.main import app  # noqa: E402
from app.ledger import NO_PARTY_TYPES  # noqa: E402
from app.services import llm_router, retry  # noqa: E402
from app.services import sarvam as sarvam_mod  # noqa: E402

MATERIAL = ROOT / "test-material"
OUT = ROOT / "artifacts" / "harness"
SYN = OUT / "synthetic"
AUDIO_EXT = {".webm": "audio/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4",
             ".wav": "audio/wav", ".ogg": "audio/ogg"}
IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
THRESHOLDS = {"voice_amount": 0.80, "voice_party": 0.70, "voice_type": 0.80, "bill_total": 0.70}

# Values that were ever given to a model as an example, or served by the removed demo mode
# (D-049). A result equal to one of these but not to the input is an "example echo".
ECHO_NAMES = {"ramesh", "rakesh", "lakshmi", "suresh", "priya", "balaji", "gupta", "sharma",
              "shree balaji traders", "sharma kirana store", "gupta traders", "balaji dairy"}
ECHO_PAISE = {25000, 350000, 12500, 120000, 50000, 600000, 10000, 188000, 360000, 125000}
ECHO_DATES = {"2026-09-24"}

# --- live call counting (every HTTP attempt, retries included) --------------------------------
CALLS: Counter = Counter()
LIMITS = {"sarvam": 10**9, "groq": 10**9}


class BudgetExceeded(RuntimeError):
    pass


def _counting(service: str):
    def with_backoff(fn, status_of):
        def counted():
            if CALLS[service] >= LIMITS[service]:
                raise BudgetExceeded(f"{service} budget for this run ({LIMITS[service]}) reached")
            CALLS[service] += 1
            return fn()
        return retry.with_backoff(counted, status_of)
    return with_backoff


sarvam_mod.with_backoff = _counting("sarvam")
llm_router.with_backoff = _counting("groq")
ratelimit.LIMITS.update({"voice": 1000, "receipts": 1000, "tts": 1000})   # the harness is one user in a hurry


# --- throwaway users ---------------------------------------------------------------------------
class Shop:
    def __init__(self, client: TestClient):
        self.client = client
        self.users: list[dict] = []
        self.shop_id: str | None = None
        self.invite: str | None = None

    def _user(self, name: str) -> dict:
        email = f"khata-harness-{uuid.uuid4().hex[:10]}@example.com"
        password = uuid.uuid4().hex
        created = admin_client().auth.admin.create_user({"email": email, "password": password, "email_confirm": True,
                                                         "user_metadata": {"name": name}})
        s = get_settings()
        anon = create_client(s.supabase_url, s.supabase_publishable_key,
                             ClientOptions(auto_refresh_token=False, persist_session=False))
        token = anon.auth.sign_in_with_password({"email": email, "password": password}).session.access_token
        u = {"id": created.user.id, "email": email, "password": password, "headers": {"Authorization": f"Bearer {token}"}}
        self.users.append(u)
        return u

    def member(self, lang: str) -> dict:
        for u in self.users:
            if u["lang"] == lang:
                return u
        u = self._user(f"Harness {lang}")
        u["lang"] = lang
        if self.shop_id is None:
            r = self.client.post("/shops", json={"name": "Harness Shop", "lang": lang}, headers=u["headers"])
            assert r.status_code == 201, r.text
            self.shop_id, self.invite = r.json()["shop"]["id"], r.json()["shop"]["invite_code"]
        else:
            r = self.client.post("/shops/join", json={"code": self.invite, "lang": lang}, headers=u["headers"])
            assert r.status_code == 200, r.text
        return u

    def save(self, path: Path) -> None:
        path.write_text(json.dumps({"shop_id": self.shop_id, "users": [
            {k: u[k] for k in ("id", "email", "password", "lang")} for u in self.users]}, indent=2))


def cleanup(shop_id: str | None, user_ids: list[str]) -> None:
    """Same teardown as tests/conftest.py: only what this harness created."""
    admin = admin_client()
    if shop_id:
        for bucket in ("voice", "receipts"):
            files = admin.storage.from_(bucket).list(shop_id) or []
            paths = [f"{shop_id}/{f['name']}" for f in files if f.get("name")]
            if paths:
                admin.storage.from_(bucket).remove(paths)
        admin.table("audit_log").delete().eq("shop_id", shop_id).execute()
        admin.table("shops").delete().eq("id", shop_id).execute()
    for uid in user_ids:
        admin.auth.admin.delete_user(uid)


# --- material ----------------------------------------------------------------------------------
def _rows(csv_path: Path) -> list[dict]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def real_material(kind: str) -> list[dict] | None:
    folder = MATERIAL / kind
    exts = AUDIO_EXT if kind == "voice" else IMAGE_EXT
    if not folder.is_dir() or not (folder / "expected.csv").exists():
        return None
    rows = [r for r in _rows(folder / "expected.csv") if (folder / r["file"]).suffix.lower() in exts
            and (folder / r["file"]).exists()]
    for r in rows:
        r["path"] = str(folder / r["file"])
    return rows or None


_REPO_TEXT: list[str] | None = None


def _repo_mentions(needle: str) -> bool:
    """Is this name/amount anywhere in the codebase (code, prompts, UI copy, tests, docs)?"""
    global _REPO_TEXT
    if _REPO_TEXT is None:
        skip = {"node_modules", ".venv", "artifacts", "dist", "test-results", ".git", "__pycache__", "test-material"}
        _REPO_TEXT = []
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = [d for d in dirnames if d not in skip]
            for f in filenames:
                if f != "harness.py" and Path(f).suffix in {".py", ".ts", ".tsx", ".md", ".sql", ".json", ".csv", ".html", ".mjs"}:
                    _REPO_TEXT.append((Path(dirpath) / f).read_text(errors="ignore"))
    pat = re.compile(rf"(?<![\w]){re.escape(needle)}(?![\w])", re.IGNORECASE)
    return any(pat.search(t) for t in _REPO_TEXT)


# Name pools: (Latin, Devanagari, Tamil). Picked at random per run and checked against the repo.
NAMES = [("Tanmay", "तन्मय", "தன்மய்"), ("Kusum", "कुसुम", "குசும்"), ("Harish", "हरीश", "ஹரீஷ்"),
         ("Pallavi", "पल्लवी", "பல்லவி"), ("Nirmal", "निर्मल", "நிர்மல்"), ("Yamini", "यामिनी", "யாமினி"),
         ("Selvi", "सेल्वी", "செல்வி"), ("Kathir", "कतिर", "கதிர்"), ("Vasanthi", "वसंती", "வசந்தி"),
         ("Bharani", "भरणी", "பரணி"), ("Harpreet", "हरप्रीत", "ஹர்ப்ரீத்"), ("Dominic", "डोमिनिक", "டொமினிக்"),
         ("Farida", "फरीदा", "ஃபரிதா"), ("Gurdeep", "गुरदीप", "குர்தீப்"), ("Jaspal", "जसपाल", "ஜஸ்பால்")]
VENDORS = ["Kaveri Provisions", "Nandini Agencies", "Tulsi Wholesale Mart", "Parvat Distributors",
           "Mehfil Traders", "Sagar Kirana Supply", "Ganga Stores", "Kesar Agencies"]


def _pick_amount(rng: random.Random, lo: int, hi: int, used: set[int]) -> int:
    while True:
        a = rng.randrange(lo, hi, 5)
        if a * 100 not in ECHO_PAISE and a not in used and not _repo_mentions(str(a)):
            used.add(a)
            return a


def synthetic_voice(rng: random.Random) -> list[dict]:
    """6 clips, 3 languages, spoken by Sarvam TTS. Cached after the first run."""
    manifest = SYN / "voice" / "expected.json"
    if manifest.exists():
        return json.loads(manifest.read_text())
    (SYN / "voice").mkdir(parents=True, exist_ok=True)
    names = [n for n in rng.sample(NAMES, len(NAMES)) if not _repo_mentions(n[0])][:6]
    used: set[int] = set()
    amt = [_pick_amount(rng, 130, 2990, used) for _ in range(6)]
    specs = [
        ("hi-IN", "credit_given", names[0], amt[0], lambda n, a: f"{n[1]} को {a} रुपये उधार दिए"),
        ("hi-IN", "payment_received", names[1], amt[1], lambda n, a: f"{n[1]} ने {a} रुपये वापस दिए"),
        ("ta-IN", "credit_given", names[2], amt[2], lambda n, a: f"{n[2]} அவர்களுக்கு {a} ரூபாய் கடன் கொடுத்தேன்"),
        ("ta-IN", "cash_sale", None, amt[3], lambda n, a: f"இன்று {a} ரூபாய் ரொக்க விற்பனை"),
        ("en-IN", "purchase_credit", names[4], amt[4], lambda n, a: f"Bought stock from {n[0]} for {a} rupees on credit"),
        ("en-IN", "expense", None, amt[5], lambda n, a: f"Paid {a} rupees for the electricity bill"),
    ]
    tts = sarvam_mod.client()
    rows = []
    for i, (lang, etype, name, amount, say) in enumerate(specs, 1):
        text = say(name, amount)
        voice = {"hi-IN": "shubh", "ta-IN": "ratan", "en-IN": "ishita"}[lang]
        audio = tts.speak(text, lang, voice)
        fname = f"clip{i}_{lang}.mp3"
        (SYN / "voice" / fname).write_bytes(audio)
        rows.append({"file": fname, "path": str(SYN / "voice" / fname), "lang": lang, "what_was_said": text,
                     "expected_type": etype, "expected_party": name[0] if name else "",
                     "expected_amount": str(amount), "tts_voice": voice})
    manifest.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    return rows


def _bill_html(vendor_line: str, sub: str, items: list[tuple[str, int, int]], labels: dict, total: int,
               bill_date: date, style: str) -> str:
    rows = "".join(f"<tr><td>{n}</td><td class=r>{q}</td><td class=r>{p:,.2f}</td><td class=r>{q * p:,.2f}</td></tr>"
                   for n, q, p in items)
    return f"""<!doctype html><html><head><meta charset=utf-8><style>
body{{margin:0;background:{'#d9d4c7' if style == 'photo' else '#fff'};font-family:'Courier New','Kohinoor Devanagari','Devanagari Sangam MN',monospace}}
.bill{{width:380px;margin:24px auto;padding:22px 20px;background:#fffdf7;color:#222;
  {'transform:rotate(1.6deg);filter:blur(0.5px) brightness(0.88) contrast(0.9);' if style == 'photo' else ''}}}
h1{{font-size:21px;text-align:center;margin:0 0 4px}} .sub{{text-align:center;font-size:13px;margin-bottom:10px}}
table{{width:100%;border-collapse:collapse;font-size:14px}} td{{padding:3px 0}} .r{{text-align:right}}
.t td{{border-top:1px dashed #333;font-size:17px;padding-top:6px}} .meta{{font-size:13px;display:flex;justify-content:space-between}}
</style></head><body><div class=bill><h1>{vendor_line}</h1><div class=sub>{sub}</div>
<div class=meta><span>{labels['bill']} 4{bill_date.day:02d}7</span><span>{labels['date']} {bill_date.strftime('%d/%m/%Y')}</span></div>
<table><tr><td>{labels['item']}</td><td class=r>{labels['qty']}</td><td class=r>{labels['rate']}</td><td class=r>{labels['amt']}</td></tr>{rows}
<tr class=t><td colspan=3>{labels['total']}</td><td class=r>{total:,.2f}</td></tr></table>
<div class=sub style="margin-top:12px">{labels['thanks']}</div></div></body></html>"""


def synthetic_bills(rng: random.Random) -> list[dict]:
    manifest = SYN / "bills" / "expected.json"
    if manifest.exists():
        return json.loads(manifest.read_text())
    folder = SYN / "bills"
    folder.mkdir(parents=True, exist_ok=True)
    vendors = [v for v in rng.sample(VENDORS, len(VENDORS)) if not _repo_mentions(v)][:3]
    en = {"bill": "Bill No.", "date": "Date", "item": "Item", "qty": "Qty", "rate": "Rate", "amt": "Amount",
          "total": "GRAND TOTAL", "thanks": "Thank you. Visit again."}
    hi = {"bill": "बिल नं.", "date": "दिनांक", "item": "सामान", "qty": "मात्रा", "rate": "दर", "amt": "रकम",
          "total": "कुल योग", "thanks": "धन्यवाद"}
    goods = [("Rice 25kg", 1), ("Toor dal", 5), ("Sugar", 10), ("Sunflower oil 1L", 6), ("Tea 500g", 4),
             ("Atta 10kg", 2), ("Soap", 12), ("Salt", 8)]
    specs = [("bill1_printed.png", "supplier", "false", vendors[0], en, "print"),
             ("bill2_photo.jpg", "supplier", "true", vendors[1], en, "photo"),
             ("bill3_hindi.png", "expense", "", vendors[2], hi, "print")]
    jobs, rows = [], []
    for fname, kind, settled, vendor, labels, style in specs:
        items = [(g, q, rng.randrange(18, 420)) for g, q in rng.sample(goods, rng.randrange(3, 5))]
        total = sum(q * p for _, q, p in items)
        while total * 100 in ECHO_PAISE or _repo_mentions(str(total)):
            items[0] = (items[0][0], items[0][1], items[0][2] + 1)
            total = sum(q * p for _, q, p in items)
        bill_date = date(2026, 9, rng.randrange(10, 25))
        sub = "Main Bazaar, Ward 7" if labels is en else "मेन बाज़ार, वार्ड 7"
        vendor_line = vendor.upper() if labels is en else f"{vendor} (किराना)"
        html = folder / (Path(fname).stem + ".html")
        html.write_text(_bill_html(vendor_line, sub, items, labels, total, bill_date, style), encoding="utf-8")
        jobs.append({"html": str(html), "out": str(folder / fname), "width": 440, "quality": 62})
        rows.append({"file": fname, "path": str(folder / fname), "kind": kind, "settled": settled,
                     "vendor": vendor, "date": bill_date.isoformat(), "total": f"{total:.2f}"})
    (folder / "jobs.json").write_text(json.dumps(jobs))
    subprocess.run(["node", str(ROOT / "frontend" / "scripts" / "render_bills.mjs"), str(folder / "jobs.json")],
                   check=True, cwd=ROOT / "frontend")
    manifest.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    return rows


# --- scoring -----------------------------------------------------------------------------------
def _norm(s: str | None) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", (s or "").lower()).split())


def name_match(got: str | None, want: str) -> bool:
    g, w = _norm(got), _norm(want)
    if not w:
        return not g
    return bool(g) and (w in g or g in w or difflib.SequenceMatcher(None, g, w).ratio() >= 0.75)


def _digits_in(text: str, rupees: int) -> bool:
    return str(rupees) in re.sub(r"(?<=\d),(?=\d)", "", text or "")


def run_voice(client: TestClient, shop: Shop, items: list[dict]) -> list[dict]:
    out = []
    for it in items:
        u = shop.member(it["lang"])
        data = Path(it["path"]).read_bytes()
        mime = AUDIO_EXT[Path(it["path"]).suffix.lower()]
        t0 = time.monotonic()
        r = client.post("/voice/entry", files={"audio": (Path(it["path"]).name, data, mime)}, headers=u["headers"])
        secs = round(time.monotonic() - t0, 1)
        body = r.json()
        res = {**{k: it.get(k) for k in ("file", "lang", "what_was_said", "expected_type", "expected_party", "expected_amount")},
               "http": r.status_code, "seconds": secs}
        if r.status_code != 200:
            res["error"] = body.get("error")
            out.append(res)
            continue
        note = admin_client().table("voice_notes").select("*").eq("id", body["voice_note_id"]).execute().data[0]
        parsed = (note.get("parsed") or {}).get("entry") or {}
        exp_amount = int(float(it["expected_amount"])) if it.get("expected_amount") else None
        got_paise = parsed.get("amount_paise")
        res.update(stt_raw=note["stt_raw"], parsed_type=parsed.get("type"), parsed_party=parsed.get("party_name"),
                   parsed_amount_paise=got_paise, needs_clarification=parsed.get("needs_clarification"),
                   decision=body["decision"], suggestion=body.get("suggestion"),
                   entry_party=(body.get("entry") or {}).get("party_name"),
                   speech_text_en=note["speech_text_en"], speech_text_local=note["speech_text_local"])
        if body.get("audio_b64"):
            mp3 = OUT / f"readback_{Path(it['file']).stem}.mp3"
            mp3.write_bytes(base64.b64decode(body["audio_b64"]))
            res["readback_audio"] = mp3.relative_to(ROOT).as_posix() if mp3.is_relative_to(ROOT) else str(mp3)
        res["ok_amount"] = exp_amount is not None and got_paise == exp_amount * 100
        res["ok_type"] = parsed.get("type") == it.get("expected_type")
        # The party the entry ended up with. Expenses / cash entries never take one (§5), so for those
        # "correct" means no party, whatever the parser called the words.
        got_party = None if parsed.get("type") in NO_PARTY_TYPES else parsed.get("party_name")
        res["ok_party"] = name_match(got_party, it.get("expected_party", ""))
        res["echo"] = [v for v in (
            f"party {parsed.get('party_name')}" if _norm(parsed.get("party_name")) in ECHO_NAMES and not res["ok_party"] else None,
            f"amount {got_paise}" if got_paise in ECHO_PAISE and not res["ok_amount"] else None) if v]
        raw = note["stt_raw"] or ""
        res["miss_stage"] = {
            "amount": None if res["ok_amount"] else ("parser" if exp_amount and _digits_in(raw, exp_amount) else "speech-to-text"),
            "party": None if res["ok_party"] else ("parser" if name_match(raw, it.get("expected_party", "")) and it.get("expected_party")
                                                    else "speech-to-text"),
            "type": None if res["ok_type"] else "parser",
        }
        out.append(res)
        print(f"voice {it['file']}: {res['decision']} amount={res['ok_amount']} party={res['ok_party']} type={res['ok_type']}"
              f" | heard: {raw!r}", flush=True)
    return out


def _rescore(r: dict) -> dict:
    """Re-apply the current party rule to a carried-over voice result (stored fields only)."""
    if r.get("http") != 200:
        return r
    got_party = None if r.get("parsed_type") in NO_PARTY_TYPES else r.get("parsed_party")
    ok = name_match(got_party, r.get("expected_party", ""))
    return {**r, "ok_party": ok, "miss_stage": {**r["miss_stage"], "party": None if ok else r["miss_stage"]["party"]}}


def run_bills(client: TestClient, shop: Shop, items: list[dict], lang: str) -> list[dict]:
    out = []
    u = shop.member(lang)
    for it in items:
        data = Path(it["path"]).read_bytes()
        mime = IMAGE_EXT[Path(it["path"]).suffix.lower()]
        form = {"kind": it["kind"]}
        if it["kind"] != "expense":
            form["settled"] = it.get("settled") or "false"
        t0 = time.monotonic()
        r = client.post("/receipts", files={"image": (Path(it["path"]).name, data, mime)}, data=form, headers=u["headers"])
        res = {**{k: it.get(k) for k in ("file", "kind", "vendor", "date", "total")}, "http": r.status_code}
        if r.status_code != 201:
            res["error"] = r.json().get("error")
            out.append(res)
            continue
        got = client.get(f"/receipts/{r.json()['receipt_id']}", headers=u["headers"]).json()   # background already ran
        res["seconds"] = round(time.monotonic() - t0, 1)
        exp_total = round(float(it["total"]) * 100) if it.get("total") else None
        res.update(receipt_id=got["receipt_id"], status=got["status"], got_vendor=got["vendor_name"],
                   got_date=got["bill_date"], got_total_paise=got["total_paise"], total_check=got.get("total_check"),
                   retried_in_english=got["retried_in_english"], ocr_text=got.get("ocr_text"), error=got.get("error"))
        res["ok_total"] = exp_total is not None and got["total_paise"] == exp_total
        res["ok_vendor"] = name_match(got["vendor_name"], it.get("vendor", ""))
        res["ok_date"] = bool(it.get("date")) and got["bill_date"] == it["date"]
        res["echo"] = [v for v in (
            f"vendor {got['vendor_name']}" if _norm(got["vendor_name"]) in ECHO_NAMES and not res["ok_vendor"] else None,
            f"total {got['total_paise']}" if got["total_paise"] in ECHO_PAISE and not res["ok_total"] else None,
            f"date {got['bill_date']}" if got["bill_date"] in ECHO_DATES and not res["ok_date"] else None) if v]
        if not res["ok_total"] and exp_total:
            rupees = exp_total // 100
            res["miss_stage"] = "extract / fallback" if _digits_in(got.get("ocr_text") or "", rupees) else "OCR text"
        out.append(res)
        print(f"bill {it['file']}: {got['status']} total={res['ok_total']} vendor={res['ok_vendor']} date={res['ok_date']}"
              f" check={got.get('total_check')}", flush=True)
    return out


def _rate(rows: list[dict], key: str) -> float | None:
    rows = [r for r in rows if r.get("http") in (200, 201)]
    return (sum(1 for r in rows if r.get(key)) / len(rows)) if rows else None


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:.0f}%"


def _md(s) -> str:
    return str(s if s is not None else "—").replace("|", "\\|").replace("\n", " ⏎ ")


def write_report(mode: dict, voice: list[dict], bills: list[dict], carried_calls: dict | None = None) -> dict:
    rates = {"voice_amount": _rate(voice, "ok_amount"), "voice_party": _rate(voice, "ok_party"),
             "voice_type": _rate(voice, "ok_type"), "bill_total": _rate(bills, "ok_total")}
    echoes = [e for r in voice + bills for e in r.get("echo", [])]
    L = [f"# Real-material harness report", "",
         f"- Run: {time.strftime('%Y-%m-%d %H:%M %Z')}",
         f"- Voice material: **{mode['voice']}** · Bill material: **{mode['bills']}**",
         f"- Path: the FastAPI app itself (POST /voice/entry; POST /receipts + BackgroundTask; GET /receipts/{{id}}), "
         f"live Sarvam + Groq, throwaway users in a throwaway shop (deleted afterwards).",
         f"- Live calls this run: Sarvam **{CALLS['sarvam']}**, Groq **{CALLS['groq']}** (every HTTP attempt, status polls included)."
         + (f" The carried-over half cost Sarvam {carried_calls.get('sarvam', 0)}, Groq {carried_calls.get('groq', 0)} in its own run."
            if carried_calls else ""),
         "", "## Thresholds", "", "| Measure | Result | Threshold | Pass |", "|---|---|---|---|"]
    for k, label in (("voice_amount", "Voice: correct amount"), ("voice_party", "Voice: correct party"),
                     ("voice_type", "Voice: correct type"), ("bill_total", "Bills: correct total")):
        ok = rates[k] is not None and rates[k] >= THRESHOLDS[k]
        L.append(f"| {label} | {_pct(rates[k])} | ≥ {THRESHOLDS[k] * 100:.0f}% | {'yes' if ok else 'NO' if rates[k] is not None else 'n/a'} |")
    L.append(f"| Example echoes (a result equal to a prompt/schema/demo example instead of the input) | {len(echoes)} | 0 | {'yes' if not echoes else 'NO'} |")
    L += ["", "## Voice", "", "| File | Lang | What was said | Raw STT (exactly as returned) | Parsed type · party · ₹ | Decision | Read-back (spoken) | Amount | Party | Type |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    for r in voice:
        if r.get("http") != 200:
            L.append(f"| {r['file']} | {r['lang']} | {_md(r['what_was_said'])} | HTTP {r.get('http')}: {_md(r.get('error'))} | | | | | | |")
            continue
        amt = f"{r['parsed_amount_paise'] / 100:g}" if r.get("parsed_amount_paise") else "—"
        L.append(f"| {r['file']} | {r['lang']} | {_md(r['what_was_said'])} | “{_md(r['stt_raw'])}” | "
                 f"{r['parsed_type']} · {_md(r['parsed_party'])} · {amt} | {r['decision']} | {_md(r['speech_text_local'])} | "
                 f"{'✓' if r['ok_amount'] else '✗ ' + (r['miss_stage']['amount'] or '')} | "
                 f"{'✓' if r['ok_party'] else '✗ ' + (r['miss_stage']['party'] or '')} | {'✓' if r['ok_type'] else '✗'} |")
    L += ["", "Read-back audio: `artifacts/harness/readback_<clip>.mp3`.", "", "## Bills", "",
          "| File | Kind | Expected vendor · date · total | Got vendor · date · total | Total check | Retried in English | Total | Vendor | Date |",
          "|---|---|---|---|---|---|---|---|---|"]
    for r in bills:
        if r.get("http") != 201:
            L.append(f"| {r['file']} | {r['kind']} | | HTTP {r.get('http')}: {_md(r.get('error'))} | | | | | |")
            continue
        got_total = f"{r['got_total_paise'] / 100:,.2f}" if r.get("got_total_paise") else "—"
        L.append(f"| {r['file']} | {r['kind']} | {_md(r['vendor'])} · {r['date']} · {r['total']} | "
                 f"{_md(r['got_vendor'])} · {_md(r['got_date'])} · {got_total} | {_md(r['total_check'])} | {r['retried_in_english']} | "
                 f"{'✓' if r['ok_total'] else '✗ ' + r.get('miss_stage', '')} | {'✓' if r['ok_vendor'] else '✗'} | {'✓' if r['ok_date'] else '✗'} |")
    L += ["", "### What the OCR read (raw Digitise text, per bill)", ""]
    for r in bills:
        L += [f"<details><summary>{r['file']}</summary>", "", "```", (r.get("ocr_text") or "(no text)").strip(), "```", "", "</details>", ""]
    L += ["## Misses", ""]
    misses = [f"- voice `{r['file']}`: {k} wrong at the **{v}** stage" for r in voice if r.get("http") == 200
              for k, v in r["miss_stage"].items() if v]
    misses += [f"- bill `{r['file']}`: total wrong; the expected total {'is' if r.get('miss_stage') == 'extract / fallback' else 'is not'} in the OCR text ({r.get('miss_stage')})"
               for r in bills if r.get("http") == 201 and not r["ok_total"]]
    L += misses or ["None."]
    L += ["", "## Example echoes", ""] + ([f"- {e}" for e in echoes] or ["None."])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    summary = {"mode": mode, "rates": rates, "echoes": echoes, "calls": dict(CALLS),
               **({"carried_calls": carried_calls} if carried_calls else {})}
    (OUT / "results.json").write_text(json.dumps({"summary": summary, "voice": voice, "bills": bills},
                                                 ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-sarvam", type=int, default=90)
    ap.add_argument("--max-groq", type=int, default=40)
    ap.add_argument("--only", choices=["voice", "bills"])
    ap.add_argument("--keep", type=Path, help="leave the throwaway shop in place; write its logins here")
    ap.add_argument("--cleanup", type=Path, help="delete a shop left by --keep")
    ap.add_argument("--bill-lang", default="hi-IN")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()
    if a.cleanup:
        d = json.loads(a.cleanup.read_text())
        cleanup(d["shop_id"], [u["id"] for u in d["users"]])
        print("cleaned up", d["shop_id"])
        return
    LIMITS.update(sarvam=a.max_sarvam, groq=a.max_groq)
    rng = random.Random(a.seed)
    OUT.mkdir(parents=True, exist_ok=True)
    voice_items = bill_items = []
    mode = {"voice": "skipped", "bills": "skipped"}
    if a.only != "bills":
        voice_items = real_material("voice")
        mode["voice"] = "real (test-material/voice)" if voice_items else "synthetic (Sarvam TTS clips)"
        voice_items = voice_items or synthetic_voice(rng)
    if a.only != "voice":
        bill_items = real_material("bills")
        mode["bills"] = "real (test-material/bills)" if bill_items else "synthetic (Chromium-rendered bills)"
        bill_items = bill_items or synthetic_bills(rng)
    client = TestClient(app)
    shop = Shop(client)
    voice = bills = []
    # With --only, the other half of the report is carried over from the previous run.
    previous = json.loads((OUT / "results.json").read_text()) if a.only and (OUT / "results.json").exists() else {}
    try:
        voice = run_voice(client, shop, voice_items) if voice_items else [_rescore(r) for r in previous.get("voice", [])]
        bills = run_bills(client, shop, bill_items, a.bill_lang) if bill_items else previous.get("bills", [])
    finally:
        if a.only:
            other = "bills" if a.only == "voice" else "voice"
            mode[other] = (previous.get("summary", {}).get("mode", {}).get(other, "not run")
                           + " (carried over from the previous run)")
        summary = write_report(mode, voice, bills, previous.get("summary", {}).get("calls") if a.only else None)
        print(json.dumps(summary, indent=2))
        if a.keep:
            shop.save(a.keep)
            print(f"kept shop {shop.shop_id}; logins in {a.keep}. Clean up with --cleanup {a.keep}")
        else:
            cleanup(shop.shop_id, [u["id"] for u in shop.users])


if __name__ == "__main__":
    main()
