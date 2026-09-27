"""GET /insights/weekly (CLAUDE.md §6.4). SQL computes, Groq only phrases.

- Week = Monday–Sunday in Asia/Kolkata; the current week is partial ("so far": up to today).
- Metrics come from the `daily_summary` view (confirmed entries only) for this week and the whole
  of last week, plus the top 3 debtors from `party_balances`. All money stays integer paise here.
- narrate_insights() receives the same numbers in rupees (§9b). Its text must only contain numbers
  from the metrics (number guard); otherwise a plain template sentence is used instead.
- Cached per shop and week in `weekly_insights`; recomputed when older than 15 minutes. The
  narration is localized per language (translate + number guard) and cached next to the metrics.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..errors import AppError
from ..langs import report_lang
from .. import ledger
from ..ledger import require_membership
from ..qa_tools import rupees
from ..services import llm_router
from ..speech import localize
from .voice import spoken_rupees

log = logging.getLogger("khata")
router = APIRouter()

CACHE_MINUTES = 15
MAX_NARRATION_CHARS = 900
FIGURES = ("cash_sales_paise", "credit_given_paise", "collected_paise", "expenses_paise",
           "purchases_paise", "supplier_paid_paise")


def week_start_for(d: date) -> date:
    return d - timedelta(days=d.weekday())  # Monday


def _totals(rows: list[dict], start: date, end: date) -> dict[str, int]:
    lo, hi = start.isoformat(), end.isoformat()
    picked = [r for r in rows if lo <= r["occurred_on"] <= hi]
    out = {k: sum(int(r[k]) for r in picked) for k in FIGURES}
    out["entry_count"] = sum(int(r["entry_count"]) for r in picked)
    return out


def compute_metrics(db, shop_id: str, today: date) -> dict:
    ws = week_start_for(today)
    prev = ws - timedelta(days=7)
    rows = (db.table("daily_summary").select("*").eq("shop_id", shop_id)
            .gte("occurred_on", prev.isoformat()).lte("occurred_on", today.isoformat()).execute().data)
    debtors = (db.table("party_balances").select("party_id, display_name, balance_paise, last_activity")
               .eq("shop_id", shop_id).gt("balance_paise", 0).order("balance_paise", desc=True)
               .order("display_name").limit(3).execute().data)
    return {
        "week_start": ws.isoformat(), "week_end": (ws + timedelta(days=6)).isoformat(), "today": today.isoformat(),
        "this_week": _totals(rows, ws, today),
        "last_week": _totals(rows, prev, ws - timedelta(days=1)),
        "top_debtors": [{"party_id": d["party_id"], "name": d["display_name"], "balance_paise": d["balance_paise"],
                         "days_since_last_activity": (today - date.fromisoformat(d["last_activity"])).days
                         if d["last_activity"] else None} for d in debtors],
    }


def rupee_metrics(m: dict) -> dict:
    """What narrate_insights sees: rupees, unit in the key (§9b)."""
    def week(w: dict) -> dict:
        return {"cash_sales_rupees": rupees(w["cash_sales_paise"]), "credit_given_rupees": rupees(w["credit_given_paise"]),
                "collected_rupees": rupees(w["collected_paise"]), "expenses_rupees": rupees(w["expenses_paise"])}
    return {"this_week_so_far": week(m["this_week"]), "last_week": week(m["last_week"]),
            "top_debtors": [{"name": d["name"], "owes_rupees": rupees(d["balance_paise"]),
                             "days_since_last_activity": d["days_since_last_activity"]} for d in m["top_debtors"]]}


def template_narration(m: dict) -> str:
    """Deterministic fallback, built only from SQL numbers."""
    tw = m["this_week"]
    if tw["entry_count"] == 0 and not m["top_debtors"]:
        return "No entries yet this week."
    parts = [f"This week so far: {spoken_rupees(tw['cash_sales_paise'])} rupees in cash sales, "
             f"{spoken_rupees(tw['credit_given_paise'])} rupees given on credit and "
             f"{spoken_rupees(tw['collected_paise'])} rupees collected."]
    if m["top_debtors"]:
        d = m["top_debtors"][0]
        parts.append(f"{d['name']} owes the most, {spoken_rupees(d['balance_paise'])} rupees.")
    return " ".join(parts)


def narrate(m: dict) -> str:
    if m["this_week"]["entry_count"] == 0 and m["last_week"]["entry_count"] == 0 and not m["top_debtors"]:
        return "No entries yet this week."          # nothing to phrase: no Groq call
    payload = rupee_metrics(m)
    try:
        text = llm_router.narrate_insights(payload)
    except AppError:
        log.warning("narration failed; using the template")
        return template_narration(m)
    # Mayura translates up to 1000 characters (docs/sarvam-notes.md); keep well under it.
    if not text or len(text) > MAX_NARRATION_CHARS or not llm_router.numbers_grounded(text, [json.dumps(payload)]):
        return template_narration(m)
    return text


def _fresh(row: dict, now: datetime) -> bool:
    created = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
    return now - created < timedelta(minutes=CACHE_MINUTES)


@router.get("/insights/weekly")
def weekly(user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    db = user_client(user.token)
    now = ledger.now_ist()
    today = now.date()
    ws = week_start_for(today).isoformat()
    rows = (db.table("weekly_insights").select("*").eq("shop_id", m["shop_id"]).eq("week_start", ws)
            .limit(1).execute().data)
    cached = rows[0] if rows and _fresh(rows[0], now) else None
    if cached:
        metrics, narration_en = cached["metrics"], cached["narration_en"]
    else:
        metrics = compute_metrics(db, m["shop_id"], today)
        narration_en = narrate(metrics)
        metrics["narration_local"] = {}
    lang = report_lang(m)                           # summaries follow the report language (GOAL_2.0 P5.3)
    local = (metrics.get("narration_local") or {}).get(lang)
    if local is None:
        local = localize(narration_en, m, lang)
        metrics["narration_local"] = {**(metrics.get("narration_local") or {}), lang: local}
        cached = None                               # store the new translation with the cache row
    if cached is None:
        db.table("weekly_insights").upsert({"shop_id": m["shop_id"], "week_start": ws, "metrics": metrics,
                                            "narration_en": narration_en,
                                            "created_at": rows[0]["created_at"] if rows and _fresh(rows[0], now)
                                            else now.isoformat()},
                                           on_conflict="shop_id,week_start").execute()
    public = {k: v for k, v in metrics.items() if k != "narration_local"}
    return {**public, "narration": local, "narration_en": narration_en}
