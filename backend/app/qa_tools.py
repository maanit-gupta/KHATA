"""The five read-only Q&A tools (llm_router.QA_TOOLS) as SQL through the caller's user-scoped
client (RLS applies). shop_id is injected by the server as the first argument; the model can't
choose it. Amounts go to the model in rupees with the unit in the key (`balance_rupees`).
Nothing here writes."""

from __future__ import annotations

from datetime import date
from typing import Any, Callable

from .ledger import ENTRY_TYPES, check_uuid
from .services.llm_router import MATCH_MARGIN

SUMMARY_COLS = {"cash_sales_paise": "cash_sales_rupees", "credit_given_paise": "credit_given_rupees",
                "collected_paise": "collected_rupees", "purchases_paise": "purchases_rupees",
                "supplier_paid_paise": "supplier_payments_rupees", "expenses_paise": "expenses_rupees"}


def rupees(paise: int) -> int | float:
    """Whole rupees as an int (so the model says "250", not "250.0"); else 2 decimals."""
    return paise // 100 if paise % 100 == 0 else round(paise / 100, 2)


def _iso(value: str | None, field: str) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError(f"{field} must be an ISO date like 2026-09-26")


def _who_owes(paise: int) -> str:
    if paise > 0:
        return "they owe the shop"
    if paise < 0:
        return "the shop owes them"
    return "settled"


def make_tools(db, today: date) -> dict[str, Callable[..., Any]]:
    def find_party(shop_id: str, name: str) -> dict:
        rows = db.rpc("find_party", {"p_shop": shop_id, "p_query": name, "p_kind": None, "p_limit": 5}).execute().data or []
        matches = [{"party_id": r["party_id"], "name": r["display_name"], "kind": r["kind"],
                    "match_score": round(float(r["score"]), 2)} for r in rows]
        ambiguous = len(rows) > 1 and float(rows[0]["score"]) - float(rows[1]["score"]) < MATCH_MARGIN
        out: dict[str, Any] = {"matches": matches}
        if not matches:
            out["note"] = "No customer or supplier has a similar name."
        elif ambiguous:
            out["note"] = "Several close matches: ask the user which one they mean, naming them."
        return out

    def get_party_balance(shop_id: str, party_id: str) -> dict:
        check_uuid(party_id, "party")
        rows = (db.table("party_balances").select("*").eq("shop_id", shop_id).eq("party_id", party_id)
                .limit(1).execute().data)
        if not rows:
            return {"error": "no such party"}
        r = rows[0]
        return {"name": r["display_name"], "kind": r["kind"], "balance_rupees": rupees(abs(r["balance_paise"])),
                "who_owes": _who_owes(r["balance_paise"]), "last_activity": r["last_activity"]}

    def list_entries(shop_id: str, party_id: str | None = None, type: str | None = None,
                     from_date: str | None = None, to_date: str | None = None, limit: int = 10) -> dict:
        q = (db.table("entries").select("occurred_on, type, amount_paise, note, parties(display_name)")
             .eq("shop_id", shop_id).eq("status", "confirmed"))
        if party_id:
            check_uuid(party_id, "party")
            q = q.eq("party_id", party_id)
        if type:
            if type not in ENTRY_TYPES:
                raise ValueError(f"type must be one of {', '.join(ENTRY_TYPES)}")
            q = q.eq("type", type)
        if f := _iso(from_date, "from_date"):
            q = q.gte("occurred_on", f)
        if t := _iso(to_date, "to_date"):
            q = q.lte("occurred_on", t)
        rows = q.order("occurred_on", desc=True).order("created_at", desc=True).limit(max(1, min(int(limit), 20))).execute().data
        return {"entries": [{"date": r["occurred_on"], "type": r["type"],
                             "party": (r.get("parties") or {}).get("display_name"),
                             "amount_rupees": rupees(r["amount_paise"]), "note": r["note"]} for r in rows]}

    def get_period_summary(shop_id: str, from_date: str, to_date: str) -> dict:
        f, t = _iso(from_date, "from_date"), _iso(to_date, "to_date")
        rows = (db.table("daily_summary").select("*").eq("shop_id", shop_id)
                .gte("occurred_on", f).lte("occurred_on", t).execute().data)
        totals = {out: rupees(sum(r[col] for r in rows)) for col, out in SUMMARY_COLS.items()}
        return {"from_date": f, "to_date": t, **totals, "entry_count": sum(r["entry_count"] for r in rows)}

    def top_debtors(shop_id: str, limit: int = 5) -> dict:
        rows = (db.table("party_balances").select("display_name, balance_paise, last_activity")
                .eq("shop_id", shop_id).gt("balance_paise", 0).order("balance_paise", desc=True)
                .limit(max(1, min(int(limit), 10))).execute().data)
        return {"debtors": [{"name": r["display_name"], "balance_rupees": rupees(r["balance_paise"]),
                             "days_since_last_activity": (today - date.fromisoformat(r["last_activity"])).days
                             if r["last_activity"] else None} for r in rows]}

    return {"find_party": find_party, "get_party_balance": get_party_balance, "list_entries": list_entries,
            "get_period_summary": get_period_summary, "top_debtors": top_debtors}
