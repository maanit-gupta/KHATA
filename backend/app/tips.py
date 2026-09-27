"""P7.1 tip rules (GOAL_2.0): deterministic, in code, over facts SQL returned (`tip_facts_json`,
migration 006). A rule that fires produces a fact object; every number in it is a SQL number. The
fired tips are ranked by rupee impact and the top 3 kept. Each tip also has a plain English template,
used when the LLM's phrasing fails the number guard.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .routers.voice import spoken_rupees

OVERDUE_DAYS = 30              # a customer 30+ days overdue …
OVERDUE_MIN_PAISE = 50_000     # … with a balance over ₹500
COLLECTIONS_DROP_PCT = 25      # collections this week more than 25% below last week
EXPENSE_SPIKE_PCT = 40         # an expense category more than 40% above its 4-week average
CREDIT_MULTIPLE = 2            # a customer's credit this month more than 2x their usual
SUPPLIER_STALE_DAYS = 30       # a supplier balance unchanged for 30+ days
REVIEW_MAX = 5                 # more than 5 items waiting in Review
TOP_N = 3

CATEGORY_WORDS = {"stock_other": "shop supplies", "rent": "rent", "electricity": "electricity", "wages": "wages",
                  "transport": "transport", "repairs": "repairs", "misc": "other expenses",
                  "uncategorised": "uncategorised expenses"}


@dataclass
class Tip:
    rule: str
    impact_paise: int              # for ranking only; never shown
    facts: dict[str, Any] = field(default_factory=dict)   # what the LLM may say (amounts in paise)
    text_en: str = ""              # the template, built from the same facts

    def public(self) -> dict:
        return {"rule": self.rule, **self.facts}


def _r(paise: int) -> str:
    return f"{spoken_rupees(paise)} rupees"


def overdue(f: dict) -> list[Tip]:
    out = []
    for a in f.get("aging") or []:
        if a["age_days"] >= OVERDUE_DAYS and a["balance_paise"] > OVERDUE_MIN_PAISE:
            since = "since their last payment" if a.get("last_payment_on") else "since they first took credit"
            out.append(Tip("overdue_customer", a["balance_paise"],
                           {"name": a["name"], "balance_paise": a["balance_paise"], "days": a["age_days"]},
                           f"{a['name']} owes {_r(a['balance_paise'])}, {a['age_days']} days {since}. Ask for a payment."))
    return out


def collections_drop(f: dict) -> list[Tip]:
    c = f.get("collections") or {}
    this, last = c.get("this_week_paise", 0), c.get("last_week_paise", 0)
    if last > 0 and this * 100 < last * (100 - COLLECTIONS_DROP_PCT):
        return [Tip("collections_down", c["drop_paise"],
                    {"this_week_paise": this, "last_week_paise": last},
                    f"Collections this week are {_r(this)}, against {_r(last)} by this day last week.")]
    return []


def expense_spike(f: dict) -> list[Tip]:
    out = []
    for e in f.get("expense_excess") or []:
        avg, this = e["prev4_avg_paise"], e["this_week_paise"]
        if avg > 0 and this * 100 > avg * (100 + EXPENSE_SPIKE_PCT):
            word = CATEGORY_WORDS.get(e["category"], e["category"])
            out.append(Tip("expense_up", e["excess_paise"],
                           {"category": e["category"], "this_week_paise": this, "usual_week_paise": avg},
                           f"Spending on {word} this week is {_r(this)}; a usual week is {_r(avg)}."))
    return out


def credit_spike(f: dict) -> list[Tip]:
    out = []
    for x in f.get("credit_excess") or []:
        usual, this = x["usual_paise"], x["this_month_paise"]
        if usual > 0 and this > usual * CREDIT_MULTIPLE:
            out.append(Tip("credit_up", x["excess_paise"],
                           {"name": x["display_name"], "this_month_paise": this, "usual_month_paise": usual},
                           f"{x['display_name']} has taken {_r(this)} on credit this month; a usual month is {_r(usual)}."))
    return out


def supplier_stale(f: dict) -> list[Tip]:
    out = []
    for s in f.get("dues") or []:
        if s["days_since_last_activity"] >= SUPPLIER_STALE_DAYS:
            out.append(Tip("supplier_unchanged", s["owed_paise"],
                           {"name": s["name"], "owed_paise": s["owed_paise"], "days": s["days_since_last_activity"]},
                           f"You owe {s['name']} {_r(s['owed_paise'])}, unchanged for {s['days_since_last_activity']} days."))
    return out


def negative_cash(f: dict) -> list[Tip]:
    days = [d for d in f.get("week_days") or [] if d["net_cash_paise"] < 0]
    if not days:
        return []
    worst = min(days, key=lambda d: (d["net_cash_paise"], d["day"]))
    return [Tip("cash_negative", -worst["net_cash_paise"],
                {"day": worst["day"], "net_cash_paise": worst["net_cash_paise"], "days_negative": len(days)},
                f"More cash went out than came in on {date.fromisoformat(worst['day']).strftime('%A')}: "
                f"{_r(-worst['net_cash_paise'])} short.")]


def review_backlog(f: dict) -> list[Tip]:
    n = int(f.get("pending_review") or 0)
    if n > REVIEW_MAX:
        return [Tip("review_backlog", int(f.get("pending_paise") or 0), {"items": n},
                    f"{n} items are waiting in Review. Confirm or fix them so the book is right.")]
    return []


RULES = (overdue, collections_drop, expense_spike, credit_spike, supplier_stale, negative_cash, review_backlog)


def fired(facts: dict) -> list[Tip]:
    """Every tip whose rule fires, largest rupee impact first (ties: rule order, then name)."""
    tips = [t for rule in RULES for t in rule(facts)]
    order = {r.__name__: i for i, r in enumerate(RULES)}
    rule_of = {"overdue_customer": "overdue", "collections_down": "collections_drop", "expense_up": "expense_spike",
               "credit_up": "credit_spike", "supplier_unchanged": "supplier_stale", "cash_negative": "negative_cash",
               "review_backlog": "review_backlog"}
    return sorted(tips, key=lambda t: (-t.impact_paise, order[rule_of[t.rule]], str(t.facts.get("name", ""))))


def top(facts: dict, n: int = TOP_N) -> list[Tip]:
    return fired(facts)[:n]
