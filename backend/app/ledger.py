"""Shared ledger helpers: shop lookup, Kolkata dates, money parsing, input checks, entry shaping."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from .auth import CurrentUser
from .errors import AppError
from .routers.me import get_membership

IST = ZoneInfo("Asia/Kolkata")
ENTRY_TYPES = ("credit_given", "payment_received", "cash_sale", "purchase_credit",
               "purchase_paid", "payment_made", "expense")
ENTRY_STATUSES = ("pending", "confirmed", "voided")
PARTY_KINDS = ("customer", "supplier")
CUSTOMER_TYPES = {"credit_given", "payment_received"}
SUPPLIER_TYPES = {"purchase_credit", "purchase_paid", "payment_made"}
NO_PARTY_TYPES = {"cash_sale", "purchase_paid", "expense"}
ENTRY_SELECT = "*, parties(display_name, kind)"

# Largest amount accepted at the API: ₹10 crore. Guards against typos and float precision
# (every rupee value below this with 2 decimals round-trips exactly through a JSON float).
MAX_PAISE = 10_000_000_000  # D-005


def now_ist() -> datetime:
    """The only clock in the backend (CLAUDE.md §9b). Tests patch this."""
    return datetime.now(IST)


def today_ist() -> date:
    return now_ist().date()


def now_iso() -> str:
    return now_ist().isoformat()


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


def rupees_to_paise(rupees: float | int | str | Decimal) -> int:
    """Exact rupees → integer paise. Rejects ≤ 0, more than 2 decimals, and absurd sizes, instead
    of silently rounding (₹10.005 is a typo, not ₹10.01)."""
    try:
        d = Decimal(str(rupees))
    except (InvalidOperation, ValueError):
        raise AppError(422, "bad_amount", "Enter the amount as a number, like 250 or 1250.50.")
    if not d.is_finite() or d <= 0:
        raise AppError(422, "bad_amount", "The amount must be more than zero.")
    paise = d * 100
    if paise != paise.to_integral_value():
        raise AppError(422, "bad_amount", "Use at most 2 digits after the decimal point.")
    if paise > MAX_PAISE:
        raise AppError(422, "bad_amount", "That amount is too large. Check it and try again.")
    return int(paise)


def check_uuid(value: str, what: str = "entry") -> str:
    """Path ids that aren't UUIDs would reach Postgres as a type error (a 500). They can't name
    anything, so answer exactly like a missing row."""
    try:
        uuid.UUID(str(value))
    except ValueError:
        raise not_found(what)
    return str(value)


def parse_iso_date(value: str | None, field: str = "date") -> str | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise AppError(422, "bad_date", f"Enter the {field} as a date like 2026-09-26.")


def expected_party_kind(entry_type: str) -> str | None:
    """Which party kind an entry of this type may point at. purchase_paid links its supplier
    (CLAUDE.md §9b); cash_sale may name a customer; expense never has a party."""
    if entry_type == "cash_sale":
        return "customer"
    return party_kind_for(entry_type)


def check_party(db, party_id: str, entry_type: str) -> dict:
    """The party must be visible to the caller (RLS: same shop) and of the right kind. A foreign
    key alone would accept another shop's party id, because FK checks ignore RLS."""
    check_uuid(party_id, "party")
    if entry_type == "expense":
        raise AppError(422, "party_not_allowed", "Expenses don't have a customer or supplier.")
    rows = db.table("parties").select("id, kind, display_name").eq("id", party_id).limit(1).execute().data
    if not rows:
        raise not_found("party")
    want = expected_party_kind(entry_type)
    if want and rows[0]["kind"] != want:
        raise AppError(422, "wrong_party_kind",
                       f"This entry type needs a {want}, and {rows[0]['display_name']} is a {rows[0]['kind']}.")
    return rows[0]


def entry_out(row: dict) -> dict:
    party = row.pop("parties", None) or {}
    row["party_name"] = party.get("display_name")
    row["party_kind"] = party.get("kind")
    return row


def not_found(what: str = "entry") -> AppError:
    return AppError(404, "not_found", f"That {what} does not exist.")
