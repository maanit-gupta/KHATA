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

### P5 Screens the spec requires
- [x] **P5.1 Review queue.** `ReviewScreen`: pending entries (CONFIRM → / EDIT), new parties (RENAME / MERGE INTO… / KEEP AS IS, D-025), failed bills (ENTER MANUALLY →, D-026). REVIEW nav chip shows the count (cyan square). E2E: `e2e/review.spec.ts` (4 tests). Screens: `artifacts/screens/P5.1-review/`.
- [x] **P5.2 Entry edit + history.** `EntryScreen`: dark form with type/amount/party/date/note, SAVE CHANGES →, history from `audit_log` ("You"/"Another member", IST time, old → new), VOID ENTRY with confirmation. Ledger rows open it. E2E: `e2e/entry.spec.ts` (3). Screens: `artifacts/screens/P5.2-entry/`.
- [x] **P5.3 Settings.** Language (PATCH /me), voice picker (varun hidden; selecting PATCHes then plays "Ramesh owes you 250 rupees." via POST /tts, localized server-side, D-006/D-027), invite code with COPY chip (all members), LOG OUT. E2E: `e2e/settings.spec.ts`. Screens: `artifacts/screens/P5.3-settings/`.
- [x] **P5.4 Party detail evidence.** ▶ plays the original audio via GET /media/voice/{id} (signed 10 min); → opens the bill photo via GET /media/receipts/{id}; balance always "OWES YOU ₹X" / "YOU OWE ₹X" in Amount style. E2E: `e2e/party.spec.ts` (2). Screens: `artifacts/screens/P5.4-party/`.
- E2E result: 10 passed (`npx playwright test e2e/review.spec.ts e2e/entry.spec.ts e2e/settings.spec.ts e2e/party.spec.ts`).

### P6 Weekly insights
- [x] `GET /insights/weekly` (`app/routers/insights.py`): Mon–Sun IST week, "so far" up to today, vs all of last week (D-029); SQL metrics from `daily_summary` + top 3 debtors from `party_balances`; cache in `weekly_insights`, recomputed after 15 min; rupees to `narrate_insights`; narration number-guarded with a template fallback (D-031); localized per language and cached (D-030).
- [x] Frontend `WeeklyCard`: mist block, "This week, / so far.", 4 figure rows with last week, narration + ▶ (POST /tts, D-032), top debtors as Rows.
- AC: `tests/test_insights.py` (6): hand-computed fixture on Thu 1 Oct 2026 (a week spanning Sep→Oct) excluding voided, pending, future and two-weeks-old entries; invented-number narration → template; cache reuse/expiry and a second language; **empty week** (no Groq call); Groq down → template. Isolation case added (`GET /insights/weekly`). E2E `e2e/ledger.spec.ts` renders and plays it. Screens: `artifacts/screens/P6-insights/`.
- E2E totals now: 20 passed (`npx playwright test`).

### P7 Landing page and design fidelity
- [x] **P7.1 Landing page** at `/` (lazy-loaded): `components/landing/{Hero, HowItWorks, PrinciplesSplit, SayItYourWay, BuiltBy, Footer}`; transparent header whose chips switch to `mix-blend-mode: difference` over `[data-dark]` sections; landing motion (15% IntersectionObserver, heading muted→ink 600ms, line draw 900ms + 120ms stagger, text wipe, square pop, sections rise 40px over 700ms, cyan split panel slides in from the right, hero squares 0.3x parallax). Six "Say it your way" lines with `TODO: native-speaker check`; BuiltBy only if `public/founder.jpg` exists. Fixed a hackathon bug found on the way: in-app links to `/demo` hit the 404 route. E2E: `e2e/landing.spec.ts`. Screens: `artifacts/screens/P7.1-landing/`.
- [x] **P7.2 Design pass.** Every screen walked against DESIGN §1–§6. Grep proof: no `rounded`/`shadow`/bold/icon-library use; gradients only in the RibbedGlass texture that DESIGN specifies; `--muted` only on pre-reveal headings, the "Loading…" status, and a card label on /about. Fixes (before = hackathon commit 4b86e02 shot against the same mock, after = now; `artifacts/screens/P7.2-design/<scene>-{before,after}-{390,1280}.png` for ledger, scan, parties, review, settings, entry, home, recording):
  - `●` glyph in the hold button → the square (§1 no icons); the hold label is "LISTENING… RELEASE TO SEND" with the 30 s hairline turning white at 25 s (§6.4).
  - Entry-row dates and the "Heard" transcript were `--muted` → ink (§2 guard).
  - Voice panel: HOLD TO ASK and SCAN A BILL → added; "Add by hand" moved beside Recent (D-023).
  - Extra SCAN nav chip removed (§5: LEDGER / PARTIES / REVIEW / SETTINGS); REVIEW count square wired.
  - Empty ledger copy + PixelSquares (§6.13).
  - Scan: tall kind cards, big chips, preview with ribbed reading strip, dark form, SAVE ENTRY → (§6.7).
  - Parties: search + CUSTOMERS/SUPPLIERS chips (§6.8); party detail balance in Amount style (§6.9).
  - Ledger rows open Entry edit (§6.3); pending/did-you-mean/clarify cards (§6.6).
  - `/` was a redirect to /login → the landing page (§7); hero squares kept clear of text (D-033).
  - Page transitions, 900px split, MENU overlay, undo hairline, focus rings: checked, already correct.
- [x] **P7.3 Reduced motion.** Playwright with `prefers-reduced-motion: reduce`: no SVG ripple `<animate>` and no filter on the ribs (control test shows the ripple exists normally), section headings already revealed, recording countdown still `30s linear`. Screens: `artifacts/screens/P7.3-reduced-motion/`.

- E2E totals now: 25 passed (`npx playwright test`, 27 s).
