"""Shared ledger helpers: shop lookup, Kolkata dates, entry/party shaping."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from .auth import CurrentUser
from .errors import AppError
from .routers.me import get_membership

IST = ZoneInfo("Asia/Kolkata")
ENTRY_TYPES = ("credit_given", "payment_received", "cash_sale", "purchase_credit",
               "purchase_paid", "payment_made", "expense")
CUSTOMER_TYPES = {"credit_given", "payment_received"}
SUPPLIER_TYPES = {"purchase_credit", "purchase_paid", "payment_made"}
NO_PARTY_TYPES = {"cash_sale", "purchase_paid", "expense"}
ENTRY_SELECT = "*, parties(display_name, kind)"


def today_ist() -> date:
    return datetime.now(IST).date()


def now_iso() -> str:
    return datetime.now(IST).isoformat()


def require_membership(user: CurrentUser) -> dict:
    m = get_membership(user)
    if not m:
        raise AppError(409, "no_shop", "Create or join a shop first.")
    return m


def party_kind_for(entry_type: str) -> str | None:
    if entry_type in CUSTOMER_TYPES:
        return "customer"
    if entry_type in SUPPLIER_TYPES:
        return "supplier"
    return None


def entry_out(row: dict) -> dict:
    party = row.pop("parties", None) or {}
    row["party_name"] = party.get("display_name")
    row["party_kind"] = party.get("kind")
    return row


def not_found(what: str = "entry") -> AppError:
    return AppError(404, "not_found", f"That {what} does not exist.")
