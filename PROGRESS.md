# PROGRESS.md

## Live API call tally

| Service | Budget | Used | Log |
|---|---|---|---|
| Sarvam (STT + TTS + translate + Document AI, each HTTP call counted, status polls included) | 40 | 28 | P2 diagnosis: 9 + 4 + 4 (3 extract jobs); P2 live E2E: 11 |
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

### P2 Fix receipt auto-fill
- [x] **P2.1 Reproduce.** `backend/scripts/debug_receipt.py` runs a bill through `receipt_ocr.read_receipt` (the production path) and saves every raw Sarvam response. 3 diagnosis jobs (limit 3): `tests/fixtures/live/receipt_20260926_174201_hi-IN.json`, `..._174310_ta-IN.json`, `..._174406_ta-IN_legacy_code.json`.
- [x] **P2.2 Root cause.** Not reproducible: all three jobs, including the hackathon's own code, returned all three fields. Every item on the checklist was verified against the docs. Most likely causes, and why the fix covers them: D-011.
- [x] **P2.3 Fix.** `app/services/receipt_ocr.py`: Extract → English retry → digitise + Groq strict-JSON fallback (`llm_router.receipt_fields`) with the number guard (`total_in_text`). D-012.
- [x] **P2.4 Background work.** `POST /receipts` returns `{receipt_id, status: queued}`; BackgroundTask polls every 2 s, 90 s per job; `GET /receipts/{id}` reports stale jobs as failed (D-015); the frontend polls every 2 s (`useReceipt`, `refetchInterval` 2000). Tests (`tests/test_receipts.py`, 36): success, first-try failure then English success, empty date → retry, double failure, fallback success, **total not found in text → left empty**, 90 s timeout (45 polls), busy service, API upload/poll/save. **Live E2E:** `scripts/live_receipt_e2e.py` → 3/3 fields (`receipt_e2e_20260926_175219_hi-IN.json`). README status line updated.
- [x] **P2.5 Save idempotent + leaves review queue (added by audit).** Second save → 409 `already_saved` (allowed again after Undo); a failed bill saved by hand becomes `done` and drops out of `/review`. DB-level guard: migration 002 (not applied, N-004).

### P3 Voice entry to spec
- [x] **P3.1 Resolve.** `POST /voice/entry/resolve` (D-019); UI chips YES, <NAME> / NO, NEW PERSON on the pending card. Tests: `test_voice_entry.py::test_resolve_use_suggested`, `::test_resolve_create_new`, `::test_resolve_keeps_the_amount_rule`, `::test_resolve_needs_a_did_you_mean_note`.
- [x] **P3.2 Clarify join.** `answer_to` form field (D-018); question text + HOLD TO ANSWER in the result card. Tests: `::test_clarify_saves_nothing_then_answer_is_joined` (Groq input is exactly `first + " " + answer`), `::test_clarify_chain_carries_all_answers`.
- [x] **P3.3 Recording edge cases.** <0.7 s → toast (`useHoldRecorder` MIN_MS; server rejects <1000 bytes with the same message); 30 s auto-send (MAX_MS timer); mic denied → full-screen instruction screen (`MicBlocked`); Safari MP4 fixture (`tests/fixtures/audio/safari_note.mp4`, real AAC) accepted as `audio/mp4`, with codecs suffix, and as sniffed octet-stream. 10 MB / MIME limits enforced. Browser checks of these in P8.4 (Playwright).
- [x] **P3.4 English then localize.** Tests assert the translate call received the English read-back/question and TTS spoke the localized text; a translation that changes a number falls back to English; TTS failure keeps the save. §12 scenarios 1–4 covered (`test_12_1` … `test_12_4`).

### P4 Voice questions
- [x] **P4.1 Tools.** `app/qa_tools.py`: all 5 QA_TOOLS as SQL through the user-scoped client, shop_id injected, amounts in rupees (`balance_rupees`, D-021). Real-data tests: `test_voice_ask.py::test_tools_return_sql_numbers_in_rupees`, `::test_tools_cannot_reach_another_shop`.
- [x] **P4.2 POST /voice/ask.** Via `voice_question_pipeline`; audio + `voice_notes` row with `purpose='question'`. Number guard on the final answer (D-020).
- [x] **P4.3 Frontend.** HOLD TO ASK (same `HoldButton` recording visuals) and an answer card with the ▶ square; audio auto-plays.
- AC: every number from a tool (`::test_every_number_in_the_answer_must_come_from_a_tool` → fallback), delete → Add-button reply (`::test_delete_request...`), ambiguous → which one (`::test_ambiguous_name_asks_which_one`), no writes (row counts and entry states unchanged), §12.5 Tamil answer = party_balances (`::test_12_5...`). Isolation case for `/voice/ask` and `/voice/entry/resolve` added.
