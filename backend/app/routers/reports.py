"""GOAL_2.0 P7: AI summary + tips, the printable report's data, and the spoken daily briefing.

Principle: SQL decides every fact and number (migration 006), code decides which tips apply
(app/tips.py), the LLM only phrases. Every string the LLM writes must pass the number guard against
the facts it was given, or a plain English template is used; then it is translated into the member's
report language with the same guard (falling back to English).

GET  /reports/summary?period=day|week|month[&date=]  cached in ai_reports by a hash of the facts
POST /reports/summary/refresh {period}                a new phrasing; once per 5 minutes per shop
GET  /reports/data?from=&to=                          report_json for the print page
GET  /briefing                                        today's briefing text (cached per shop/day/lang)
POST /briefing/audio                                  its audio, cached per language and voice
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from .. import tips as tip_rules
from ..auth import CurrentUser, current_user
from ..db import user_client
from ..errors import AppError
from ..langs import report_lang, voice_for
from ..ledger import now_ist, parse_iso_date, require_membership, today_ist
from ..qa_tools import rupees
from ..ratelimit import rate_limit
from ..services import llm_router
from ..services import sarvam as sarvam_service
from ..speech import localize
from ..storage import signed_url, upload
from .voice import spoken_rupees

router = APIRouter()
log = logging.getLogger("khata")

Period = Literal["day", "week", "month"]
REFRESH_MINUTES = 5
MAX_REPORT_DAYS = 92
BRIEFING_MAX_CHARS = 700
EN = "en-IN"
FIGS = ("cash_sales", "credit_given", "collected", "expenses", "purchases", "supplier_paid", "net_cash")
LABEL = {"day": "today", "week": "this week", "month": "this month"}
COMPARED = {"day": "the same day last week", "week": "the same days last week", "month": "the same days last month"}


# --- facts ------------------------------------------------------------------------------------
def _figs(t: dict) -> dict:
    return {f"{k}_rupees": rupees(t[f"{k}_paise"]) for k in FIGS} | {"entry_count": t["entry_count"]}


def _tip_rupees(tip: tip_rules.Tip) -> dict:
    out = {"rule": tip.rule}
    for k, v in tip.facts.items():
        out[k.removesuffix("_paise") + "_rupees" if k.endswith("_paise") else k] = rupees(v) if k.endswith("_paise") else v
    return out


def summary_facts(db, shop_id: str, period: str, anchor: date) -> tuple[dict, list[tip_rules.Tip]]:
    raw = db.rpc("summary_facts_json", {"p_shop": shop_id, "p_period": period, "p_today": anchor.isoformat()}).execute().data
    top = tip_rules.top(raw)
    facts = {
        "period": period, "label": LABEL[period], "from": raw["current_from"], "to": raw["current_to"],
        "so_far": anchor == today_ist(), "compared_with": COMPARED[period],
        "current": _figs(raw["current"]), "previous": _figs(raw["previous"]),
        "pending_review": raw["pending_review"], "tips": [_tip_rupees(t) for t in top],
    }
    return facts, top


def facts_hash(facts: dict) -> str:
    return hashlib.sha256(json.dumps(facts, sort_keys=True, default=str).encode()).hexdigest()


# --- phrasing ---------------------------------------------------------------------------------
def template_summary(facts: dict) -> str:
    c, label = facts["current"], facts["label"]
    if c["entry_count"] == 0:
        return f"No entries yet {label}." if facts["so_far"] else f"No entries {label}."
    so_far = " so far" if facts["so_far"] else ""
    return (f"{label[0].upper()}{label[1:]}{so_far}: {spoken_rupees(round(c['cash_sales_rupees'] * 100))} rupees in cash sales, "
            f"{spoken_rupees(round(c['credit_given_rupees'] * 100))} rupees given on credit, "
            f"{spoken_rupees(round(c['collected_rupees'] * 100))} rupees collected and "
            f"{spoken_rupees(round(c['expenses_rupees'] * 100))} rupees spent.")


def phrase(facts: dict, top: list[tip_rules.Tip]) -> tuple[str, list[str]]:
    """(summary, tips) in English. Each LLM string is kept only if its numbers are in the facts."""
    templates = [t.text_en for t in top]
    if facts["current"]["entry_count"] == 0 and facts["previous"]["entry_count"] == 0 and not top:
        return template_summary(facts), []        # nothing to phrase: no Groq call
    try:
        summary, tips = llm_router.phrase_report(facts)
    except AppError:
        log.warning("report phrasing failed; using templates")
        return template_summary(facts), templates
    source = [json.dumps(facts)]
    if not summary or not llm_router.numbers_grounded(summary, source):
        summary = template_summary(facts)
    if len(tips) != len(top):
        tips = templates
    else:
        tips = [t if t and llm_router.numbers_grounded(t, [json.dumps(facts["tips"][i])]) else templates[i]
                for i, t in enumerate(tips)]
    return summary, tips


def _translate(summary: str, tips: list[str], member: dict, lang: str) -> dict:
    if lang == EN:
        return {"summary": summary, "tips": tips}
    return {"summary": localize(summary, member, lang), "tips": [localize(t, member, lang) for t in tips]}


def period_start(period: str, anchor: date) -> date:
    return anchor if period == "day" else anchor - timedelta(days=anchor.weekday()) if period == "week" else anchor.replace(day=1)


def _age_minutes(row: dict) -> float:
    created = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
    return (now_ist() - created).total_seconds() / 60


def build_summary(user: CurrentUser, m: dict, period: str, anchor: date, force: bool = False) -> dict:
    db = user_client(user.token)
    shop_id, lang = m["shop_id"], report_lang(m)
    start = period_start(period, anchor)
    facts, top = summary_facts(db, shop_id, period, anchor)
    h = facts_hash(facts)
    rows = {r["lang"]: r for r in (db.table("ai_reports").select("*").eq("shop_id", shop_id).eq("period_type", period)
                                   .eq("period_start", start.isoformat()).in_("lang", list({EN, lang})).execute().data)}
    en = rows.get(EN)
    if force and en and _age_minutes(en) < REFRESH_MINUTES:
        wait = max(1, round(REFRESH_MINUTES - _age_minutes(en)))
        raise AppError(429, "refresh_too_soon", f"This summary was just written. You can refresh it again in {wait} min.")
    key = {"shop_id": shop_id, "period_type": period, "period_start": start.isoformat()}
    cached = bool(en and en["facts_hash"] == h and not force)
    if cached:
        english = json.loads(en["text"])
    else:
        summary, tip_texts = phrase(facts, top)
        english = {"summary": summary, "tips": tip_texts}
        en = {**key, "lang": EN, "facts": facts, "facts_hash": h, "text": json.dumps(english, ensure_ascii=False),
              "created_at": now_ist().isoformat()}
        db.table("ai_reports").upsert(en, on_conflict="shop_id,period_type,period_start,lang").execute()
    local = english
    if lang != EN:
        row = rows.get(lang)
        if cached and row and row["facts_hash"] == h:
            local = json.loads(row["text"])
        else:
            local = _translate(english["summary"], english["tips"], m, lang)
            db.table("ai_reports").upsert({**key, "lang": lang, "facts": facts, "facts_hash": h,
                                           "text": json.dumps(local, ensure_ascii=False), "created_at": en["created_at"]},
                                          on_conflict="shop_id,period_type,period_start,lang").execute()
    return {"period": period, "period_start": start.isoformat(), "from": facts["from"], "to": facts["to"],
            "lang": lang, "summary": local["summary"], "tips": local["tips"],
            "summary_en": english["summary"], "tips_en": english["tips"],
            "tip_facts": [t.public() for t in top], "cached": cached, "generated_at": en["created_at"]}


def _anchor(raw: str | None) -> date:
    d = date.fromisoformat(parse_iso_date(raw, "report date")) if raw else today_ist()
    if d > today_ist():
        raise AppError(422, "future_date", "That date is in the future.")
    return d


@router.get("/reports/summary")
def get_summary(period: Period = "day", date_: str | None = Query(default=None, alias="date"),
                user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    return build_summary(user, m, period, _anchor(date_))


class RefreshBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period: Period = "day"


@router.post("/reports/summary/refresh")
def refresh_summary(body: RefreshBody, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    return build_summary(user, m, body.period, today_ist(), force=True)


@router.get("/reports/data")
def report_data(date_from: str = Query(alias="from"), date_to: str = Query(alias="to"),
                user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    f, t = parse_iso_date(date_from, "start date"), parse_iso_date(date_to, "end date")
    if not f or not t or f > t:
        raise AppError(422, "bad_range", "Pick a start date on or before the end date.")
    if (date.fromisoformat(t) - date.fromisoformat(f)).days + 1 > MAX_REPORT_DAYS:
        raise AppError(422, "range_too_long", f"A report covers at most {MAX_REPORT_DAYS} days.")
    return user_client(user.token).rpc("report_json", {"p_shop": m["shop_id"], "p_from": f, "p_to": t}).execute().data


# --- P7.4 daily briefing --------------------------------------------------------------------
def briefing_script(facts: dict) -> str:
    """Yesterday's figures, today's top tip, and the pending review count; English, from SQL numbers."""
    y = facts["yesterday"]
    parts = []
    if y["entry_count"] == 0:
        parts.append("Yesterday there were no entries.")
    else:
        parts.append(f"Yesterday: {spoken_rupees(y['cash_sales_paise'])} rupees in cash sales, "
                     f"{spoken_rupees(y['credit_given_paise'])} rupees given on credit, "
                     f"{spoken_rupees(y['collected_paise'])} rupees collected and "
                     f"{spoken_rupees(y['expenses_paise'])} rupees spent.")
    top = tip_rules.top(facts, 1)
    if top:
        parts.append(top[0].text_en)
    n = int(facts["pending_review"])
    parts.append("Nothing is waiting in Review." if n == 0 else "1 item is waiting in Review." if n == 1
                 else f"{n} items are waiting in Review.")
    text = " ".join(parts)
    return text if len(text) <= BRIEFING_MAX_CHARS else " ".join(parts[:1] + parts[-1:])


def _briefing_row(user: CurrentUser, m: dict) -> dict:
    db = user_client(user.token)
    shop_id, lang, today = m["shop_id"], report_lang(m), today_ist()
    rows = (db.table("daily_briefings").select("*").eq("shop_id", shop_id).eq("day", today.isoformat())
            .eq("lang", lang).limit(1).execute().data)
    if rows:
        return rows[0]                  # one briefing per shop, day and language: a morning snapshot
    facts = db.rpc("tip_facts_json", {"p_shop": shop_id, "p_today": today.isoformat()}).execute().data
    text_en = briefing_script(facts)
    text = localize(text_en, m, lang) if lang != EN else text_en
    if len(text) > BRIEFING_MAX_CHARS:
        text = text_en[:BRIEFING_MAX_CHARS]
    row = {"shop_id": shop_id, "day": today.isoformat(), "lang": lang, "facts": facts, "facts_hash": facts_hash(facts),
           "text_en": text_en, "text": text, "audio": {}, "created_at": now_ist().isoformat()}
    db.table("daily_briefings").upsert(row, on_conflict="shop_id,day,lang").execute()
    return row


@router.get("/briefing")
def get_briefing(user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    row = _briefing_row(user, m)
    voice = voice_for(m, row["lang"])
    return {"day": row["day"], "lang": row["lang"], "text": row["text"], "text_en": row["text_en"],
            "voice": voice, "audio_cached": voice in (row.get("audio") or {})}


@router.post("/briefing/audio", dependencies=[Depends(rate_limit("tts"))])
def briefing_audio(user: CurrentUser = Depends(current_user)):
    """The briefing spoken in the report language with that language's voice. Stored once per
    language and voice, so replays (and other members with the same settings) cost nothing."""
    m = require_membership(user)
    row = _briefing_row(user, m)
    voice = voice_for(m, row["lang"])
    audio = dict(row.get("audio") or {})
    path = audio.get(voice)
    cached = bool(path)
    if not path:
        mp3 = sarvam_service.client().speak(row["text"], row["lang"], voice)
        path = upload("voice", m["shop_id"], mp3, "audio/mpeg", "mp3")
        audio[voice] = path
        user_client(user.token).table("daily_briefings").update({"audio": audio}).eq("shop_id", m["shop_id"]) \
            .eq("day", row["day"]).eq("lang", row["lang"]).execute()
    return {"url": signed_url("voice", path, m["shop_id"]), "voice": voice, "cached": cached}

