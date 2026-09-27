"""GET /dashboard (GOAL_2.0 P6): "How is my shop doing, who owes me, what do I owe?"

Every number comes from SQL: `dashboard_json` (migration 005) assembles the migration 003 views and
004 functions in one round trip, read as the caller so RLS applies; this route passes it through and
adds nothing up. (Nine separate queries cost ~200 ms each from the app server; one costs ~250 ms.)
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, Response

from ..auth import CurrentUser, current_user
from ..db import user_client
from ..ledger import require_membership, today_ist

router = APIRouter()
log = logging.getLogger("khata")


def dashboard_data(token: str, shop_id: str, today) -> dict:
    """All dashboard figures for `today` (an IST date). Also used by the P7 summaries and report."""
    return user_client(token).rpc("dashboard_json", {"p_shop": shop_id, "p_today": today.isoformat()}).execute().data


@router.get("/dashboard")
def dashboard(response: Response, user: CurrentUser = Depends(current_user)):
    m = require_membership(user)
    t0 = time.perf_counter()
    out = dashboard_data(user.token, m["shop_id"], today_ist())
    ms = round((time.perf_counter() - t0) * 1000)
    response.headers["Server-Timing"] = f"db;dur={ms}"
    log.info("dashboard %d ms", ms)
    return out
