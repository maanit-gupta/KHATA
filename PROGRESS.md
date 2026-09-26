# PROGRESS.md

## Live API call tally

| Service | Budget | Used | Log |
|---|---|---|---|
| Sarvam (STT + TTS + translate + Document AI, each call counted) | 40 | 0 | — |
| Groq | 60 | 0 | — |

## Tasks

- [x] **P0 Audit** — `AUDIT.md`. Baseline: pytest 15 passed; build OK (205 KB gzip); lint 0 errors / 4 warnings; tsc root is a no-op.

### P1 Correctness and security foundation
- [x] **P1.1 Test suite green.** 123 passed, 0 failed, 0 skipped (`backend/.venv/bin/pytest -q`, 232 s). Fixed `conftest` teardown: audit rows and Storage files of throwaway shops are deleted first (D-003); verified 0 users / 0 shops left afterwards.
- [x] **P1.2 Tenant isolation.** `tests/test_isolation.py`: one case per API route (20 so far) + `test_every_route_is_covered` (fails if a new route has no case), reads/inserts/updates/deletes on every table and view with A's token, and Storage (A can't sign or download B's audio or bill photo). Routes added later (resolve, ask, insights, receipts upload) get cases in their own tasks.
- [x] **P1.3 Membership tamper.** `test_shops.py::test_member_cannot_tamper_with_membership[shop_id|user_id|role]` pass against the live DB; lang update still allowed. Trigger present (behaviour); SQL check in N-002.
- [x] **P1.4 Money invariants.** `tests/test_money.py` (30 tests): all 7 types, voids excluded, pending excluded, edits of amount/type/party move balances, ₹0.10 / ₹1,250.50 / ₹5,000 / ₹5,000.01 at the API, ₹5,000.01 by voice → `confirm` (pending, needs a tap). Frontend en-IN formatting test: added in P8 with the Playwright runner.
- [x] **P1.5 Timezone.** `tests/test_timezone.py`: voice entry at 23:30 UTC 26 Sep → `occurred_on` 2026-09-27 and "Today is 2026-09-27." in the Groq prompt; grep test proves no `utcnow`/`date.today()`/naive `datetime.now()` in `app/`.
- [x] **P1.6 Audit trail.** `tests/test_audit.py`: create / edit / confirm / void rows with before/after and actor; staff edit shows as `another_member` to the owner; audit_log not writable by users.
- [x] **P1.7 Error shape and retries.** `tests/test_errors.py`: error shapes on 401/404/405/409/422; Sarvam and Groq retry 429/503 at 1/2/4 s then `service_busy`; other errors don't retry; voice entry with Groq or STT busy → 503 and no entry, no party.
- [x] **P1.8 Input validation (added by audit).** `tests/test_validation.py`: foreign `party_id` → 404 and B's balance untouched; wrong party kind → 422; non-UUID ids → 404; impossible dates → 422.
