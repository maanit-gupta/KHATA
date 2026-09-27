# PROGRESS.md

# Run 2 (GOAL_2.0.md) — branch `goal/khata-2`, from `goal/complete-khata` (not merged into `main`)

## Live API call tally (run 2)

| Service | Budget | Used | Log |
|---|---|---|---|
| Sarvam (every HTTP call counted: STT, TTS, translate, Document AI start/status/results) | 150 | 97 | P1.4 harness run 1: 42 (6 TTS clips, 6 STT, 4 translate, 6 TTS read-backs, 3 bills 20); P1.4 bills re-run after the D-050 fix: 21; P1.5 comparison: 28 (18 translate, 6 TTS, 4 STT); P2 live UI scan: 6 |
| Groq | 200 | 6 | P1.4 harness run 1: 6 parses |

## Tasks

### P0 Access, identity, loose ends
- [x] **P0.1 Supabase access.** Connector lists 1 org / 1 project: `LedgerPro` `yspgbhgjdwbmxpnkgoeu` = `backend/.env` = deployed Vercel bundle. Counts: users 0, shops 0, members 0, entries 0, parties 0, voice_notes 0, receipts 0, storage objects 4. Render API `khata-api.onrender.com` → 503 "Service Suspended". D-046, D-047.
- [x] **P0.2 Catalog checks** (`scripts/verify_db.sql` through the connector, 2026-09-26):

  | check | ok |
  |---|---|
  | rls on shops / shop_members / parties / party_aliases / receipts / voice_notes / entries / audit_log / weekly_insights | true ×9 |
  | security_invoker on party_balances / daily_summary / review_queue | true ×3 |
  | trigger shop_members_no_tamper (migration 001) | true |
  | trigger entries_audit + entries_audit_upd | true |
  | bucket voice is private | true |
  | bucket receipts is private | true |

  Every row `ok`; no fix tasks needed.
- [x] **P0.3 Migrations 001 + 002.** 001 already present (`block_membership_tamper` + `shop_members_no_tamper`). 002 applied via `apply_migration`; `entries_one_live_per_receipt` now in `pg_indexes`. D-048.
- [ ] **P0.4 Orphaned recordings.** Preconditions proven by SQL (shop absent; 0 referencing rows). **Delete refused by the session's permission classifier**; not retried. Moved to NEEDS_HUMAN N-008 with the 4 file names. D-048.
- [x] **P0.5 NEEDS_HUMAN.md rewritten.** Closed N-001, N-002, N-003 (DB half), N-004 with evidence; N-005 folded into N-011 (test material); `landing.builtFor` = "Built for Sarvam Campus Builds, September 2026."; new N-010 (Render suspended), N-011 (test material).

### P1 Make speech and OCR tell the truth
- [x] **P1.1 Leak hunt.** Culprit: demo mode (canned voice + bill results behind a sessionStorage flag, reachable from "Try the demo" on the login screen) — removed (D-049). Prompts: example amount removed from QA, example date from the Groq receipt schema; no party names anywhere. STT: no prompt/context parameter exists; kwargs pinned by a test. `tests/test_leaks.py` (20 tests) + `tests/leak_allowlist.json` (2 entries, each with a reason). Production bundle grepped clean. Regression: `e2e/landing.spec.ts` "no demo mode".
- [x] **P1.2 Stale-data hunt.** Every candidate checked (table in D-049). Tests: (a) `e2e/stale.spec.ts` two known clips (440 Hz, 880 Hz) recorded back to back → uploads decode to 440 then 880 Hz, second not longer than itself; (c) same file: fresh object URL per read-back, old one revoked; (e) `tests/test_truth.py::test_stt_uses_the_speakers_language_not_the_shops`; also (b) no-store headers, (d) distinct paths + exact stored bytes, (f) mislabelled MP4 sent as audio/mp4, bytes unchanged.
- [x] **P1.3 Observability.** Migration 003 applied (D-055). `voice_notes.stt_raw / decision / speech_text_en / speech_text_local` + `parsed`; `receipts.ocr_text` + `raw_extract` (with `total_check`). UI: WHAT I HEARD on every voice result card, the answer card and the entry screen; WHAT I READ on the scan form and bill entries (`components/ui/Disclosure.tsx`). **Live evidence:** after the harness run, the DB held every stage for 6 clips and 3 bills (e.g. stt_raw "Gurdeep was given ₹2600 as a loan." → parsed Gurdeep / 260000 → auto → "Gurdeep, 2,600 rupees उधार लिए, save कर लिए।"); screenshots of the real app on that data: `artifacts/screens/P1.3-observability/` (entry WHAT I HEARD in hi/ta, Hindi bill WHAT I READ). Tests: `tests/test_truth.py::test_every_stage_is_recorded_on_the_voice_note`, `::test_question_stages_are_recorded`, `test_receipts.py` (ocr_text stored separately), `e2e/truth.spec.ts` (3).
- [x] **P1.4 Harness.** `backend/scripts/harness.py` → `artifacts/harness/report.md`. `test-material/` missing → synthetic (N-011). **Results: voice amount 6/6, party 6/6, type 6/6; bill totals 3/3 (vendor 3/3, date 3/3, total_check ok 3/3); example echoes 0.** Run 1 found D-050 (OCR text always empty); bills re-run after the fix.
- [x] **P1.5 Speech output.** `constants.TRANSLATE` per language (default unchanged). `artifacts/tts-compare/` 6 MP3s + report. Pronunciation check: every amount heard back correctly (4 clips). N-009 for a native speaker. D-054.
- [x] **P1.6 STT robustness.** Silence/filler → "I didn't catch that", nothing saved, no Groq call (`test_truth.py::test_silence_and_filler_transcripts_save_nothing`, `::test_heard_nothing_is_narrow`, `test_voice_ask.py::test_silence_does_not_call_groq`); auto-detect supported and wired (`speech_auto` → `language_code "unknown"`, `test_truth.py::test_auto_detect_sends_unknown_and_keeps_the_detected_language`). D-052, D-053.

### P2 Scan and upload that actually works
- [x] **P2.1 Capture.** Phones: TAKE A PHOTO opens the camera (`capture="environment"`, `accept="image/*"`) + a separate UPLOAD FROM GALLERY link. Desktop: CHOOSE A FILE + drag-and-drop zone. JPG/PNG as-is; HEIC converted where the browser decodes it, otherwise a clear message; one-page PDF sent as-is (D-056). `lib/photo.ts`.
- [x] **P2.2 Preview.** Full-width preview, USE THIS PHOTO / RETAKE / TURN 90° (re-encoded JPEG); "Photo too dark or small; retake for better reading." when mean luminance < 60 or the short edge < 600 px, and sending anyway works.
- [x] **P2.3 Progress.** UPLOADING → READING THE BILL → CHECKING from real job stages; CANCEL; TYPE IT IN INSTEAD after 90 s (D-057).
- [x] **P2.4 Review form.** Filled / "Not found, please type." / "Check this"; total `inputmode="decimal"`; date input with IST default; tap the photo to enlarge it beside the form; WHAT I READ (D-058).
- [x] **P2.5 Flow.** Kind and Paid/Credit changeable on the form; saved entry + ANOTHER BILL; double submit blocked in the UI, the API and the DB.
- AC: `e2e/scan.spec.ts` (14 tests: success, partial, fail, cancel, retake, dark/small, rotate, HEIC, PDF, drag-drop, kind change, 90 s type-it-in, double submit, phone camera) all pass; backend `test_receipts.py` +5 (PDF pages, stages, type-it-in with no late overwrite, kind change). Screenshots 390/1280: `artifacts/screens/P2-scan/`. **Live scan through the new UI** (local API + vite, live Sarvam, throwaway user, the synthetic phone-photo bill): read in 6.7 s, vendor/date/total all correct (₹2,464), saved; `artifacts/screens/P2-scan-live/`. No real paper bill exists (N-011).

### P3 Ledger access
- [x] **P3.1 Ledger table** at `/app/ledger`; nav chips HOME / LEDGER / PARTIES / REVIEW / SETTINGS. Columns date | party | type | amount | source | added by | status; 50 per page (server-side); presets Today / This week / This month / Custom (+ All); type, party, source, member, status filters (voided only when chosen); search over party names and notes; totals row (cash in, credit given, collected, expenses; confirmed only); rows open entry edit; horizontal scroll inside a focusable region on phones. `GET /ledger` over SQL `ledger_rows` / `ledger_totals` (D-059).
- [x] **P3.2 Party statement** in party detail: date | description | +/− | balance after, from the `party_statement` view (window function); date range with opening balance; SHARE STATEMENT → `/app/report?party=…` (print view built in P7.3). `GET /parties/{id}/statement`.
- [x] **P3.3 CSV export** `GET /ledger/export.csv` (same filters; rupees with 2 decimals; IST; UTF-8 BOM; `Amount (₹)`); logged in CLAUDE.md's API table.
- [x] **P3.4 Quick manual add** (`components/ManualAdd.tsx`, on HOME and LEDGER): type chips, `inputmode="decimal"`, autocomplete from `GET /parties/suggest` (find_party, then prefix), date defaults to today (IST), Enter submits, stays open with "SAVED. ADD ANOTHER".
- AC: `tests/test_ledger.py` (11: default view, voided only when asked, every filter, search, added-by names, bad filters, pagination 57 rows + totals over the whole set, CSV contents, statement running balance with a void and an edit = party_balances, supplier sign, suggest); isolation cases for all 4 new routes and all new SQL functions/views; `e2e/ledger-table.spec.ts` (6: desktop table + filters, phone scroll, pagination, CSV download, quick add, statement) and the table added to the a11y + keyboard walks. Screens: `artifacts/screens/P3-ledger/`.

### P4 Collaboration
- [x] **P4.1 Real member names.** `shop_members.display_name` written at create/join from the signup name; Settings → MY NAME edits your own (`PATCH /me`); backfill script ran (0 rows to fill: no members existed). Everywhere that said "You" / "Another member" now shows the name, "(you)" after your own (entry history, entry "Added by / Confirmed by", ledger table, recent rows, activity, members list). D-061.
- [x] **P4.2 Live sync.** Realtime publication has `entries`, `parties`, `receipts` (migration 003). `lib/live.ts`: one channel per shop, `shop_id` filter, the user's session; every change invalidates ledger, parties, review, dashboard and member caches; another member's insert shows "ASHA ADDED ₹640 · LAKSHMI" (no Undo).
- [x] **P4.3 Attribution** on recent rows ("Added by Priya"), the ledger table's ADDED BY column, entry detail (added by / confirmed by) and every history row.
- [x] **P4.4 Activity feed** on `/app/dashboard`: last 30 audit rows as who · what · when (`GET /activity`).
- [x] **P4.5 Undo belongs to the creator**: only the 5 s toast of the member who saved it; others get the no-Undo live toast.
- [x] **P4.6 Members list** in Settings: name, role, joined date; invite code for everyone (`GET /members`). "Everyone in the shop can do the same things."
- AC: `e2e/collab.spec.ts` (5): two browsers in one shop, A adds by hand → B's table gains the row without a reload with "Asha added ₹640 · Lakshmi", a third browser in another shop on the same Realtime server gets nothing; Undo only for the creator; attribution; members + my name; activity feed. Backend `tests/test_members.py` (6) incl. **live Supabase Realtime**: a same-shop member receives the insert, a member of another shop receives nothing. Live two-browser check on the local stack against real Supabase (`frontend/scripts/live_collab.mjs`, no Sarvam/Groq calls): B saw A's entry arrive with the toast, `artifacts/screens/P4-collab-live/`. Screens: `artifacts/screens/P4-collab/`.

### P5 Language per aspect
- [x] **P5.1 Settings → LANGUAGES**: ON-SCREEN TEXT, I SPEAK IN (+ "Detect automatically" switch), READ-BACKS AND ANSWERS IN, SUMMARIES AND REPORTS IN; each lists the six languages in their own script; a tap saves at once (`PATCH /me`). The voice list follows the read-back language.
- [x] **P5.2 UI translation.** `src/strings/{en,hi,ta,te,kn,ml}.ts`, one `Strings` type so a missing/extra key fails `tsc`; the five non-English files are marked NEEDS NATIVE REVIEW (N-012). Switching re-mounts the app under the new strings with no reload; html `lang` follows; dates use that language's month names with 0–9 digits; amounts, names and brand words unchanged. Hard-coded English found and moved into strings on the way: live toast, relative times ("just now"), "(you)"/"Member". Indic UI: letter-spacing 0 and taller label/heading lines (DESIGN.md §3). D-062.
- [x] **P5.3 Pipeline.** STT uses `lang` (or auto); read-backs, answers and the settings sample translate to and speak in `voice_lang` with that language's voice; the weekly narration and `POST /tts {purpose: "report"}` use `report_lang`.
- AC: `backend/tests/test_langs.py` (unit fallbacks ×7 + the mixed combination end to end through the real routes: heard as Hindi, read back and answered in Tamil with the Tamil voice, weekly summary in a third language, `/tts` purpose split; clearing an aspect falls back); `e2e/languages.spec.ts` (pickers; UI switch applies at once and survives reload; the mixed combination speak hi / hear ta / screens en / reports ta; no sideways scroll at 390 px on six screens in en, hi, ta and ml). Screens: `artifacts/screens/P5-languages/` (Settings and Ledger in English, Hindi, Tamil at 390 and 1280).

### P6 Dashboard
- [x] **P6.1 Today strip**: cash sales, credit given, collected, expenses, each with its change vs the same weekday last week ("+₹100 vs 20 Sep"; SQL `today_vs_last_week`).
- [x] **P6.2 Daily register**, last 30 days: date | cash sales | credit given | collected | purchases | supplier paid | expenses | net cash in hand; sortable (aria-sort); Mon–Sun subtotal rows in date order; the net formula under the table and tested.
- [x] **P6.3 Who owes me**: bucket totals (0–7 / 8–30 / 31–60 / 60+) as a header strip, then name | owes you | oldest due | last payment | age; rows open the party statement; the age rule in the help text.
- [x] **P6.4 What I owe**: supplier | you owe | last payment | days.
- [x] **P6.5 Charts** (recharts, flat ink/cyan, square markers, hairline axes): sales vs collections (30 days), outstanding credit over time (reconstructed from entries), expenses by category this month. D-063.
- [x] **P6.6 Expense categories**: column from migration 003; `parse_entry` strict nullable enum; chips on quick add, the expense bill form, entry edit; "Uncategorised" for null.
- [x] **P6.7 Top customers** this month by credit given and by collections.
- AC: `backend/tests/test_dashboard.py` (9, live DB, hand-computed: empty shop; register/strip/outstanding with a voided and a pending entry excluded and credit carried in from before the window; aging bucket edges 0/7/8/30/31/60/61 + dues; month boundary for categories and top customers; category rules; voice parse category ×3; no-shop 409) + `test_receipts.py` category chip + isolation for `/dashboard`, the 004 functions and `dashboard_json`. `e2e/dashboard.spec.ts` (5). **Speed: 1098 ms median in the browser, 715 ms API, on a seeded 716-entry shop** (D-064, `artifacts/perf/dashboard.json`). Migrations 004 and 005 applied (additive: new functions only). Screens: `artifacts/screens/P6-dashboard/` (mocked, 390/1280) and `P6-dashboard-live/` (the seeded shop, real data).

---

# Run 1 (GOAL.md) — archived

## Live API call tally

| Service | Budget | Used | Log |
|---|---|---|---|
| Sarvam (STT + TTS + translate + Document AI, each HTTP call counted, status polls included) | 40 | 34 | P2 diagnosis: 9 + 4 + 4 (3 extract jobs); P2 live E2E: 11; P9 live voice check: 6 (2 STT, 2 translate, 2 TTS) |
| Groq | 60 | 4 | P9 live voice check: 1 parse (gpt-oss-20b) + 3 Q&A turns (gpt-oss-120b: find_party → get_party_balance → answer) |

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

### P8 Hardening and quality
- [x] **P8.1 Offline and errors.** Full-screen ink overlay "No internet. / Entries can’t be saved right now." with RETRY (D-042); every API error shows its `message` (Voice, manual form, scan, review, entry, settings); no apologetic copy (`e2e/unit.spec.ts` greps frontend `src/` and backend `app/` for "sorry"/"apologise"; backend error-shape test checks every message). E2E: `e2e/errors.spec.ts`. Screens: `artifacts/screens/P8.1-offline/`.
- [x] **P8.2 Accessibility.** `e2e/a11y.spec.ts` (25): axe WCAG 2.1 A/AA (serious+critical = 0) on 11 screens at 390 and 1280; every visible control ≥ 48×48; every field labelled; focus ring 2px solid square, white on dark panels; **keyboard walk of all 11 screens** (every visible control reachable by Tab, each showing a ≥2px ring; fixed: native date inputs showed no ring, now ringed via `:focus-within`); keyboard-only flow (hold ADD with Space, open an entry with Enter, void via the confirmation); MENU overlay opens, focuses its first link, closes on Escape. `aria-live` on the result/answer region and toasts (`role=status`). Decorative squares `aria-hidden`. Fixed on the way: an `--muted` label on /about failed contrast.
- [x] **P8.3 Performance.** Landing, About, Onboarding, Parties, Party detail, Review, Entry, Scan and Settings are lazy chunks. **Main chunk 85.4 KB gzip** (275 KB raw); first load of /app ≈ 211 KB gzip including shared vendor chunks (supabase-js 61.9 KB, router/UI 40.5 KB, framer-motion 23.3 KB). Before: one 205 KB-gzip chunk with every screen. React Query `staleTime` 30 s, `gcTime` 10 min: going back to the Ledger shows cached data at once; writes invalidate what they touch.
- [x] **P8.4 Playwright e2e.** `e2e/journey.spec.ts`: signup → onboarding (create shop, Hindi) → manual entry → voice entry over ₹5,000 (confirm) → auto-saved voice entry (undo) → parties → party detail → scan (mocked OCR, polled, total edited) → review (keep new supplier) → settings (language, voice sample). Headless, passes. The voice steps use Chromium's fake microphone fed with `e2e/fixtures/voice.wav`.
- [x] **P8.5 Security sweep.** `backend/tests/test_security.py`: CORS answers only `ALLOWED_ORIGINS` (evil origin gets no ACAO); unhandled 500s keep CORS + error shape and leak no detail (D-038, a bug found and fixed); `admin_client` used only in `routers/shops.py` and `storage.py`; no `print(` and no logging of tokens/secrets/passwords; httpx URL logging turned down to WARNING; 10 MB + MIME allow-lists (tests in `test_receipts.py`, `test_voice_entry.py`); per-user rate limits on voice/receipts/TTS (D-037) with a 429 test. Git history scanned for keys in P0: none. Postgrest timeout 30 s (D-039).
- [x] **P8.6 Render cold start.** DEPLOY.md "Cold starts" (open /health a minute before; ping every 10 min to keep warm). Frontend shows "Waking the server…" if the first request (GET /me) takes over 3 s (D-041). E2E: `errors.spec.ts` cold-start test. Screens: `artifacts/screens/P8.6-cold-start/`.

### P9 Docs and handoff
- [x] **README.md**: Status table rewritten line by line (every ✅ backed by a test or live check in this file; ⚠️ for migration 002 and untested handwritten bills); demo tour updated; setup and test commands (`pytest`, `npm run build/lint/typecheck`, `npm run test:e2e`). **Verified from a clean clone** (`git clone` into a temp dir): fresh Python 3.12 venv + `pip install -r requirements.txt` + `uvicorn` → `/health` `{"ok":true}`; `npm ci` → build (main chunk 85.4 KB gzip) → lint (0) → typecheck (0) → Playwright 47/47.
- [x] **DEPLOY.md**: ordered checklist with migrations (001 applied, 002 pending), env vars, CORS check, cold-start / keep-warm note.
- [x] **DEMO.md**: 3-minute script with a fallback for each step (`/demo` as the universal fallback).
- [x] **CLAUDE.md**: §6.5 rows updated where the contract changed (answer_to, receipts status, /tts, entry history) and a new §14 listing each spec change with its D-number.
- [x] **P9.1 Demo mode (added by audit)**: `lib/demo.ts` serves entry edit/history, review, weekly insights, ask, did-you-mean resolve, settings, party rename/merge. E2E `e2e/demo.spec.ts` walks them with zero API calls.
- [x] **Live voice check** (`backend/scripts/live_voice_check.py`, 6 Sarvam + 4 Groq): Safari MP4 → STT → parse → auto-save → Hindi read-back; question → real Groq tool calls (`find_party` → `get_party_balance`) → "Ramesh currently owes 250 rupees." → Hindi. Found and fixed: a `note` that just echoes the transcript is dropped. Found: code-mixed Hindi translation (N-009).

### Stretch
- [x] Fuzzy thresholds evaluated on 40 names / 68 variants: precision 0.95, recall 0.47; proposal in D-044 (no code change).
- [x] STT priming with party names behind `STT_PRIME_PARTY_NAMES` (default off, saaras:v4 only): D-045.

## Final checks (on commit after 273aef1)
- Backend: `.venv/bin/pytest -q` → **216 passed, 0 failed, 0 skipped** (557 s, live Supabase, Sarvam/Groq faked). Project left with 0 users / 0 shops.
- Frontend: `npm run build` OK (main chunk 85.39 KB gzip) · `npm run lint` 0 warnings / 0 errors · `npm run typecheck` 0 · `npx tsc --noEmit` 0 (see README note) · `npx playwright test` **58 passed**.
