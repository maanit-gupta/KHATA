# GOAL_2.0.md: Make KHATA truly work, then make it a shopkeeper's tool

Another long, **unattended** run. The first run (GOAL.md) built the missing pieces. The owner's
hands-on testing shows the core is still unreliable:
- speech-to-text seems to keep "hearing" a stock example phrase instead of what was said;
- OCR returns what look like preset values;
- the scan screen is clumsy;
- ledger access is weak.

This run fixes the truth of the pipeline first, then adds collaboration, per-aspect languages,
a real dashboard, and AI reports.

**Inherited rules:** every operating rule in `GOAL.md` §1 (autonomy, decision log, safety rails,
git, secrets, money invariants, working style) still applies, and §6 (out of scope) still applies.
The changes below override only what they explicitly name. Keep maintaining `PROGRESS.md`,
`DECISIONS.md`, `NEEDS_HUMAN.md`, and `AUDIT.md`; write the final report to `REPORT_2.md`.

Source of truth, in priority order:
1. This file
2. `GOAL.md`
3. `CLAUDE.md`
4. `DESIGN.md`
5. `docs/*-notes.md`

---

## 0. Definition of done
All of the following, or a stop condition from GOAL.md §9:

- **P0–P8 done**, with each task's acceptance criteria (AC) evidenced in `PROGRESS.md`, or
  moved to `NEEDS_HUMAN.md` with a reason.
- **The real-material harness (P1.4) passes its thresholds** on the owner's recordings and
  bills in `test-material/`. If that folder is missing or empty, log it in `NEEDS_HUMAN.md`
  and use the fallback in P1.4.
- **Everything passes with zero failures:** backend tests, frontend build + lint + typecheck,
  and the Playwright suite (extended in P9).
- **No fixture, mock, sample, or seed data is reachable from any production code path.**
  P1.1 must prove this.
- **`REPORT_2.md` is written** (format in §7).

---

## 1. Changes to the inherited rules

**Branch.**
- If `goal/complete-khata` is already merged into `main`, branch `goal/khata-2` from `main`.
- Otherwise branch it from `goal/complete-khata`.
- Never push to `main`. Never deploy.

**Live API budget for this run.**
- Sarvam: **150 calls**. Groq: **200 calls**. Track both in `PROGRESS.md`.
- Real-material testing (P1.4) gets first claim on the budget. Everything else uses mocks.

**Mocks must be test-only.**
- Mocks and fixtures may live only under `backend/tests/` and `frontend/tests/` (or `e2e/`).
- Production code must never import from those folders.
- Production code must never read a `USE_MOCK` / `DEMO_MODE`-style flag that swaps in canned data.
- Add a test that fails if any file under `backend/app/` or `frontend/src/` references `fixtures`,
  `mock`, `sample_`, `seed`, or `tests/`. Allowed exceptions go in a written allowlist, each
  with a reason.

**Database access.**
The owner has re-done Supabase authentication; the first run used a project with the wrong
account. At the very start:

1. **Check the Supabase MCP connector.** Confirm it can list projects and see the project whose
   ref matches `SUPABASE_URL` in `backend/.env`.
2. **Check that project has the real data.** Count `auth.users`, `shops`, and `entries`.
   - If it has 0 users while the deployed app is known to have sign-ups, find the project that
     holds them (list the connector's projects).
   - Record which project is which in `DECISIONS.md`.
   - If `backend/.env` points at the wrong one, log exact fix instructions in `NEEDS_HUMAN.md`.
     Never edit `.env` values yourself.
3. **Additive migrations** may now be applied through the MCP connector (`apply_migration`).
   The additive-only rule from GOAL.md §1.2 still holds.
4. **If the connector still can't reach the project,** fall back to REST with the secret key
   for reads and log every piece of DDL you couldn't apply.

---

## 2. Read first
1. `GOAL.md`, `REPORT.md`, `PROGRESS.md`, `DECISIONS.md`, `NEEDS_HUMAN.md`, `AUDIT.md` from the
   first run
2. `CLAUDE.md`, `DESIGN.md`, `docs/sarvam-notes.md`, `docs/groq-notes.md`
3. The whole `backend/app/`, `frontend/src/`, `migrations/`, `scripts/`, `backend/tests/`
4. Every file in `test-material/` (see P1.4 for the layout)

---

## 3. Work queue (strict order)

### P0: Access, identity, and the first run's loose ends

**P0.1 Supabase access check** (§1 "Database access"). Record the result in `DECISIONS.md`.
- AC: the project ref, user/shop/entry counts, and whether it matches `backend/.env`, are all
  written down.

**P0.2 Run the catalog checks yourself** (closes N-002). Execute `scripts/verify_db.sql` through
the connector and paste the results into `PROGRESS.md`.
- AC: every row is `ok`, or each failure has a fix task.

**P0.3 Apply migration 002** (closes N-004), and migration 001 too if it's missing on the real
project.
- AC: both are present in the catalog.

**P0.4 Orphaned recordings** (closes N-008). Confirm through the database that shop
`7e399260-f258-417b-aa09-1da10eb5e153` does not exist and no `voice_notes` row references
those files. Only if both are true, delete those 4 objects from the `voice` bucket. This is the
single authorized deletion in this run. Log it.
- AC: the objects are gone, and the log names each file.

**P0.5 Rewrite NEEDS_HUMAN.md.**
- Close N-002, N-004, N-008, and the database half of N-001/N-003, with evidence.
- Set `landing.builtFor` to "Built for Sarvam Campus Builds, September 2026." (part of N-006).
- Keep only items that truly need the owner.
- AC: every remaining item says exactly what the owner must do and why Claude couldn't do it.

### P1: Make speech and OCR tell the truth (highest-value work)

The owner reports that STT seems to return a stock phrase and OCR returns preset-looking values.
**Treat these as bugs until proven otherwise**, and investigate every candidate below. Several
may be true at once. For each candidate, record in `DECISIONS.md`:
`checked how | evidence | culprit? yes/no | fix`.

**P1.1 Leak hunt (static).**
- (a) Grep all production code for fixture, sample, seed, and demo data, including anything from
  `tests/fixtures/live/`, and for any fallback that returns canned text or values when a call
  fails, times out, or returns empty.
- (b) Grep the prompts (`PARSE_SYSTEM`, `QA_SYSTEM`, the narration prompts) for example names
  and amounts such as "Ramesh" or "250". An LLM given `Ramesh ko 250 udhaar diya` as an example
  will pull ambiguous transcripts toward it. Keep the number-word rules, but make them
  context-free ("dhai sau = 250") and use no party names anywhere in any prompt.
- (c) Check whether the STT call passes any `prompt`, context, or priming parameter that
  contains an example phrase. Remove it.
- (d) Check whether the OCR extract schema contains `example`, `default`, or sample values
  (for example "ABC Traders", "2026-01-01", a fixed total). Models echo schema examples back.
  Strip them.
- (e) Add the "no fixtures in prod" test from §1.
- AC: the leak test passes, and every culprit found is fixed with a regression test.

**P1.2 Stale-data hunt (runtime).**
- (a) **Frontend recording.** Is the `MediaRecorder` chunk array cleared between recordings?
  Is the `Blob` rebuilt each time? Is the *previous* recording being re-sent? Write a Playwright
  test that records two different fixture audios back to back and asserts the second upload's
  bytes differ from the first.
- (b) **Request caching.** Check that React Query or fetch isn't returning a cached voice or OCR
  response (POSTs must never be cached; results must be keyed by a new id).
- (c) **TTS playback.** Is an old audio element or object URL being replayed? Every result must
  create a fresh object URL and revoke the old one.
- (d) **Backend storage.** Check the backend isn't reading a fixed storage path or reusing one
  file name.
- (e) **Wrong language code.** Is the STT `language_code` actually the user's speech language,
  not hard-coded (`hi-IN`) or taken from the shop default?
- (f) **Audio format.** Does the backend send the real content type and a sample rate Saaras
  accepts? If it converts WebM/MP4, is the conversion correct (duration preserved, not silent)?
  Test with a fixture whose content is known.
- AC: each item is checked with evidence; tests exist for (a), (c), and (e).

**P1.3 Observability.**
- Store every stage's raw output per voice note:
  - `stt_raw` (the exact transcript Sarvam returned, before any processing)
  - `parsed`
  - `decision`
  - `speech_text_en`
  - `speech_text_local`
- For receipts, store the raw OCR text/markdown and the raw extract separately from the final
  fields.
- Add these as nullable columns in migration 003 (§4).
- In the UI, add a small "WHAT I HEARD" disclosure on every voice result card showing the raw
  transcript, and a "WHAT I READ" disclosure on the scan review form showing the raw OCR text.
  This builds the shopkeeper's trust and makes bugs visible.
- AC: after one live voice entry and one live scan, each stage's data is visible in the database
  and the UI.

**P1.4 Real-material harness.** Build `backend/scripts/harness.py`. It runs the owner's real
files through the exact production code paths and writes `artifacts/harness/report.md`.

Expected `test-material/` layout (log in `NEEDS_HUMAN.md` whatever is missing):
```
test-material/voice/*.webm|mp3|m4a|wav
test-material/voice/expected.csv   # file,lang,what_was_said,expected_type,expected_party,expected_amount
test-material/bills/*.jpg|png
test-material/bills/expected.csv   # file,kind,vendor,date,total
```

- **Voice report, per file:** raw STT text, parsed entry, the decision, a match against
  expected, and the TTS read-back (audio saved to `artifacts/harness/`).
- **Bill report, per file:** raw OCR text, extracted fields, match against expected.
- **Thresholds:**
  - voice: correct amount in ≥ 80% of files, correct party in ≥ 70%, correct type in ≥ 80%;
  - bills: correct total in ≥ 70%;
  - **zero** results that match a prompt or schema example rather than the input.
- **Fallback if `test-material/` is empty:**
  - Generate 6 voice clips with Sarvam TTS in 3 languages, using random names and amounts
    not found anywhere in the codebase, and feed them back through STT.
  - Render 3 bills with random vendors and totals as images.
  - Clearly label the report "synthetic".
- AC: the report is committed, the thresholds are met or each miss is explained with its root
  cause, and there are no example-echo results.

**P1.5 Speech output quality** (N-009).
- Using 3 fixed English sentences, produce Hindi and Tamil read-backs with three options:
  - Mayura `modern-colloquial`
  - Mayura `formal`
  - `sarvam-translate:v1`
- Save them to `artifacts/tts-compare/`, which costs about 18 calls.
- Keep the current setting, but make the translate mode a config value per language, and add a
  `NEEDS_HUMAN.md` item asking a native speaker to pick from the samples.
- Check that Bulbul pronounces amounts correctly. If digits read badly in some language,
  pre-format amounts for speech (for example "250 rupees") per the notes.
- AC: the samples exist, the config is in place, and a number pronunciation check is recorded.

**P1.6 STT robustness.**
- Handle silence and empty transcripts: say "I didn't catch that", save nothing.
- Handle very short or noisy clips.
- Handle a user speaking a different language from their setting: check the docs for
  auto-detect (for example a `language_code` of "unknown"). If it's supported, add
  "Auto-detect" as a speech-language option (P5); otherwise log it.
- AC: tests for empty and silent input; a decision recorded on auto-detect.

### P2: Scan and upload that actually works (DESIGN.md §6.7, made functional)

- **P2.1 Capture.**
  - On mobile, the camera opens directly (`capture="environment"`). A separate "UPLOAD FROM
    GALLERY" link is also offered.
  - On desktop, offer file pick plus drag-and-drop.
  - Accept JPG, PNG, HEIC (convert HEIC in the browser, or reject it with a clear message
    if conversion isn't feasible), and PDF (first page).
- **P2.2 Preview before sending.**
  - Show a full-width preview with RETAKE and USE THIS PHOTO.
  - Allow rotating 90° (receipts are often sideways).
  - Warn when the image is very dark or under 600px on its short edge ("Photo too dark or small;
    retake for better reading"). Allow proceeding anyway.
- **P2.3 Clear progress.** Show three steps: UPLOADING → READING THE BILL → CHECKING. Include
  a cancel option and a 90s timeout with a "Type it in instead" exit.
- **P2.4 Review form.**
  - Each field shows one of: filled (ink), "Not found, please type" (empty with helper text),
    or "Check this" (when the total failed the number guard).
  - The total field uses the numeric keyboard (`inputmode="decimal"`).
  - The date field is a date input with an IST default.
  - Tapping the image thumbnail enlarges it next to the form, so the user can compare.
  - Include the "WHAT I READ" disclosure from P1.3.
- **P2.5 Flow basics.**
  - The bill kind and Paid/Credit choices can be changed on the review form (not only
    before scanning).
  - After saving, show the resulting entry and an "ANOTHER BILL" button.
  - Double-submit is impossible (migration 002 plus disabling the button).
- AC: a Playwright test with mocked OCR covers every path (success, partial, fail, cancel,
  retake); screenshots at 390 and 1280; one live scan of a real bill passes.

### P3: Ledger access (the shopkeeper's view of their book)

- **P3.1 Full ledger table** at `/app/ledger`, a new nav chip LEDGER (the voice home becomes
  HOME).
  - Columns: date | party | type | amount | source (voice/bill/manual) | added by | status.
  - Server-side pagination, 50 rows per page.
  - Filters: date range (presets: Today, This week, This month, Custom), type, party, source,
    member, and status. Include voided entries only when that filter is chosen.
  - Search across party names and notes.
  - Totals row for the filtered set: cash in, credit given, collected, and expenses.
  - Tapping a row opens entry edit.
  - The table scrolls horizontally inside its container on mobile (DESIGN.md: the body never
    scrolls sideways).
- **P3.2 Party statement** (in party detail).
  - A chronological statement table with columns date | description | +/− | running balance,
    computed in SQL with a window function in a new `party_statement` view
    (`security_invoker`), in migration 003.
  - Date-range filter.
  - A "SHARE STATEMENT" action that opens the print/PDF view (P7.3) for just that party.
- **P3.3 Export.** A CSV export of any filtered ledger view from a backend endpoint.
  Amounts are in rupees with 2 decimals; dates use Asia/Kolkata. Log it in the API table.
- **P3.4 Quick manual add.**
  - The amount field uses `inputmode="decimal"`.
  - Party autocomplete uses `find_party`.
  - Type is chosen with chips.
  - The date defaults to today (IST).
  - Keyboard: Enter submits. A successful save keeps the form open for the next entry
    ("SAVED. ADD ANOTHER").
- AC: API tests for filters, pagination, totals, the running balance (including voided and
  edited entries), and CSV output; Playwright tests for the table on mobile and desktop.

### P4: Collaboration (live sync + who did what)

- **P4.1 Real member names.**
  - Add a `display_name` column on `shop_members` (migration 003) and backfill it from each
    user's auth metadata through the admin API.
  - Signup keeps writing it, and Settings lets each user edit their own name.
  - Everywhere the first run shows "You" / "Another member", show the real name, with "(you)"
    after your own.
- **P4.2 Live sync.**
  - Add `entries`, `parties`, and `receipts` to the `supabase_realtime` publication
    (migration 003, additive).
  - The frontend subscribes to `postgres_changes` filtered by `shop_id`, using the user's
    session so RLS applies.
  - Changes update React Query caches: the lists, balances, dashboard, and review count.
  - When another member adds an entry, show a toast: "PRIYA ADDED ₹250 · RAMESH".
  - Test that RLS stops another shop's changes from arriving.
- **P4.3 Attribution everywhere.** Show "Added by" on entry rows and in the ledger table,
  "Edited by" in history, and "Confirmed by" on confirmed pending entries.
- **P4.4 Activity feed.** A section on the dashboard listing the last 30 actions from
  `audit_log`, shown as "who · what · when".
- **P4.5 Undo belongs to the creator.** The 5s Undo toast appears only for the member who made
  the entry.
- **P4.6 Members list** in Settings: each member's name, role, joined date, and the invite code.
  Permissions stay identical (a locked owner decision).
- AC:
  - a two-browser Playwright test (two users in the same shop) where A adds an entry and B sees
    it appear without reloading;
  - a test that a third user in another shop receives nothing;
  - screenshots.

### P5: Language per aspect

The owner's decision: **each user chooses the language separately for each aspect**. There are
four per-user settings, stored on `shop_members` (migration 003: nullable columns that fall back
to `lang` when empty).

| Setting | Controls |
|---|---|
| `ui_lang` | On-screen text: buttons, labels, messages |
| `lang` (existing) | The language I speak in (sets the STT `language_code`, plus "Auto" if P1.6 found it supported) |
| `voice_lang` | The language read-backs and answers are spoken in (translate target + TTS) |
| `report_lang` | The language of summaries, tips, the daily briefing, and PDF reports |

- **P5.1 Settings.** Build a "Languages" section with the four pickers, each showing language
  names in their own script. Changes apply immediately.
- **P5.2 UI translation.**
  - Move every string into `src/strings/<lang>.ts` for `en, hi, ta, te, kn, ml`, all with the
    same keys; a type check enforces that the key sets match.
  - Write the translations yourself (don't spend Sarvam calls). Keep amounts, names, and
    brand words unchanged.
  - Mark each non-English file `NEEDS NATIVE REVIEW` in a header comment, and add a
    `NEEDS_HUMAN.md` item for it.
  - UPPERCASE styling applies to Latin text only (DESIGN.md §3).
  - Check that the layout holds when labels get longer; Malayalam and Tamil run long.
- **P5.3 Pipeline wiring.**
  - STT uses `lang`. Read-backs and answers translate to `voice_lang` and speak in `voice_lang`
    using that language's voice.
  - Reports use `report_lang`.
  - Mixed settings must work end to end, for example speak Hindi, hear Tamil, read an English
    UI, get Tamil reports.
- AC: a unit test for fallback logic; a mocked end-to-end test of that mixed combination;
  screenshots of Settings and Ledger in 3 UI languages.

### P6: Dashboard with tables and charts (`/app/dashboard`, nav chip DASHBOARD)

Written from a shopkeeper's perspective: "How is my shop doing, who owes me, what do I owe?"
**All numbers come from SQL** (new `security_invoker` views or RPCs in migration 003). Nothing
shown here is computed by an LLM.

- **P6.1 Today strip.** Four figures, each with its change vs the same day last week:
  cash sales, credit given, collected, and expenses.
- **P6.2 Daily register table** (last 30 days): date | cash sales | credit given | collected |
  purchases | supplier paid | expenses | net cash in hand
  (cash sales + collected − purchases paid − supplier paid − expenses).
  - Sortable. Weekly subtotal rows.
  - The formula is written into the column's help text and tested.
- **P6.3 Who owes me (credit aging).**
  - A table of customers with a positive balance, bucketed by age of the oldest unpaid credit:
    0–7, 8–30, 31–60, and 60+ days.
  - Columns: name | balance | oldest due | last payment date | bucket.
  - Bucket totals in a header row. Rows link to the party statement.
  - Use a simple, documented rule for "age": days since the last `payment_received`, or since
    the first `credit_given` if they've never paid.
- **P6.4 What I owe.** The same idea for suppliers: name | balance | last payment | days.
- **P6.5 Charts.** Style them flat per DESIGN.md: ink and cyan only, no gradients, no rounded
  bars, square markers, hairline axes. Add `recharts`, and log the choice.
  - sales vs collections over the last 30 days (line);
  - outstanding credit over time (line, reconstructed from entries);
  - expenses by category this month (bars).
- **P6.6 Expense categories.**
  - Add a nullable `expense_category` column on `entries`, restricted to
    `stock_other, rent, electricity, wages, transport, repairs, misc` (migration 003).
  - `parse_entry` fills it for `expense` entries, via a strict schema field that may be null.
  - Receipts of kind expense get a category chip on the review form.
  - Manual add offers the chips too.
  - Old rows with no category show as "Uncategorised".
- **P6.7 Top customers** this month, by credit given and by collections (two small tables).
- AC:
  - each view has a test against hand-computed fixtures, including an empty shop, a month
    boundary, and voided entries excluded;
  - the dashboard loads in under 1.5 s on the seeded shop (measured and logged);
  - screenshots at 390 and 1280.

### P7: AI summaries, tips, daily briefing, and PDF report

**Principle:** SQL decides every fact and number. Code decides which tips apply. The LLM only
phrases things. Every number in LLM output must pass a number guard against the facts given
to it; if it fails, fall back to a plain template in English, translated.

- **P7.1 Tip rules** (deterministic, in code). Each rule produces a fact object when it fires.
  Starting rules:
  - a customer is 30+ days overdue with a balance over ₹500;
  - collections this week are more than 25% below last week;
  - an expense category is more than 40% above its 4-week average;
  - a customer's credit this month is more than 2× their usual;
  - a supplier's balance hasn't changed in 30+ days;
  - cash-in-hand was negative on any day this week;
  - there are more than 5 pending review items.
  Rank the fired rules by rupee impact and keep the top 3.
- **P7.2 AI summary + tips card** (on the dashboard, daily and weekly tabs).
  - `gpt-oss-20b` phrases the day's or week's metrics plus the top tips, in `report_lang`.
  - Cache the result in a new `ai_reports` table (shop_id, period_type, period_start, lang,
    facts jsonb, text, created_at), in migration 003.
  - Regenerate when the facts change (compare a hash of the facts); keep the cached copy
    otherwise.
  - A REFRESH action is rate-limited to once per 5 minutes.
- **P7.3 Downloadable PDF report.**
  - Build a print-optimised page at `/app/report?period=day|week|month&from=&to=` (and
    `&party=` for statements) that renders:
    - the summary and tips;
    - the daily register;
    - the credit aging and supplier tables;
    - the charts (static SVG);
    - a footer with the shop name, date range, and "Generated by KHATA".
  - Use a print stylesheet that fits A4 with the DESIGN.md typography.
  - "DOWNLOAD PDF" calls `window.print()`, which lets the user save as PDF.
  - **Why print and not a server-side PDF:** the browser shapes all six Indic scripts
    correctly, while pure-Python PDF libraries break Indic text and headless Chrome is too heavy
    for Render's free tier. Log this in `DECISIONS.md`.
  - Verify the print output of a Tamil and a Hindi report (Playwright `page.pdf()` in tests).
- **P7.4 Spoken daily briefing.**
  - On the first dashboard or home visit each day, show a "TODAY'S BRIEFING" card with a
    play control. Don't autoplay; browsers block audio without a tap.
  - The script is yesterday's figures, today's top tip, and the pending review count, in
    `report_lang`, spoken with `report_lang`'s voice. Keep it under 700 characters.
  - Cache the text per shop, day, and language, and the audio per member's language and voice,
    so replays cost nothing.
- **P7.5 Ask about reports.** Voice Q&A (HOLD TO ASK) gains two read-only tools:
  `get_daily_register(from, to)` and `get_credit_aging()`. That way "who hasn't paid in a month?"
  works.
- AC:
  - tests that every tip rule fires and stays silent correctly on fixtures;
  - a number-guard test where a fabricated number is rejected and the template is used;
  - cache hit and miss tests;
  - a PDF render test in 2 scripts;
  - one live briefing generated and played in 2 languages (count it against the budget).

### P8: The missed-spec sweep (things a rushed build usually skips)

Work through these, fixing and testing each. Add anything else you find.

- **Auth and session:**
  - a token refresh before expiry;
  - an expired session mid-action takes the user to login and then returns them to where they
    were;
  - password reset by email (Supabase `resetPasswordForEmail`, plus a page to set the new
    password);
  - a "Show password" toggle;
  - clear error messages ("Wrong email or password", "An account with this email exists").
- **Mobile basics:**
  - iOS Safari recording (MP4) and playback (audio unlock after the first tap);
  - numeric keyboards on every amount field;
  - forms not hidden behind the on-screen keyboard;
  - safe-area insets (`env(safe-area-inset-*)`) respected on the fixed header and toasts;
  - no sideways page scroll anywhere.
- **Loading and empty states:**
  - flat skeleton blocks (no shimmer gradients) on every list, table, and chart;
  - an empty state on every screen that teaches the next action.
- **Correctness details:**
  - voided entries are visibly struck through everywhere;
  - pending entries never count in balances or dashboard figures;
  - editing a party's type (customer ↔ supplier) is blocked if it has entries (explain why);
  - duplicate party names are prevented by the unique index and surfaced as "Already exists:
    open it?".
- **Formatting:**
  - ₹ with en-IN grouping everywhere, including charts and CSV headers;
  - dates shown as "26 Sep 2026" in IST;
  - relative times ("2 min ago") in the activity feed.
- **Resilience:**
  - the Render cold-start "Waking the server…" state is verified;
  - every Sarvam/Groq failure leaves the user a way forward (type it in, or retry).
- **Accessibility:**
  - all new tables have proper `<th scope>`;
  - charts have a text summary for screen readers;
  - all new controls are 48px or larger.
- **Design:**
  - new screens follow DESIGN.md: radius 0, weight 400, status squares, hairline table rows,
    no icon libraries;
  - update DESIGN.md with the new screens (Ledger table, Dashboard, Report print page) in the
    same style it already uses.
- **AC:** each item ticked in `PROGRESS.md` with evidence.

### P9: Regression, e2e, docs
- Extend the Playwright suite to cover:
  - scan (all paths);
  - the ledger table and filters;
  - the party statement;
  - CSV download;
  - two-user live sync;
  - the language settings;
  - dashboard render;
  - summary card;
  - briefing play;
  - print report.
- Run the full backend suite and the full real-material harness (P1.4) one final time.
- Docs:
  - update the README "Status" section and the setup steps (migration 003 and Realtime);
  - update `DEPLOY.md` (migrations 002–003, no new env vars expected; say so if that changes);
  - update `DEMO.md` with the new flows;
  - update `CLAUDE.md`'s API table with every new endpoint;
  - update `DESIGN.md` per P8.

---

## 4. Migration 003 (additive only; write it first in P1.3 and extend it as needed)

Apply it through the MCP connector once it has been reviewed against the additive rule.

- `voice_notes`: `stt_raw text`, `decision text`, `speech_text_en text`,
  `speech_text_local text`.
- `receipts`: `ocr_text text`, `extract_raw jsonb` (if `raw_extract` already covers the latter,
  reuse it; don't duplicate).
- `shop_members`: `display_name text`, `ui_lang app_lang`, `voice_lang app_lang`,
  `report_lang app_lang`.
- `entries`: `expense_category text` with a check constraint listing the allowed values, or null.
- New tables `ai_reports` and `daily_briefings`, with RLS enabled and `is_member` policies,
  following the existing patterns.
- New views `party_statement`, `credit_aging`, `supplier_dues`, `daily_register`, all
  `security_invoker = true`.
- `alter publication supabase_realtime add table entries, parties, receipts;`
- Indexes needed by the ledger filters (created with `if not exists`).

No drops, renames, type changes, or loosened policies. If something needs one, write it to a
separate unapplied file and log it in `NEEDS_HUMAN.md`.

---

## 5. Out of scope
Everything in GOAL.md §6 **except** the UI translation that P5 now requires. Also out of scope:
- owner/staff permission differences (owner decision: permissions stay identical);
- customer-facing khata links;
- WhatsApp;
- push notifications;
- server-side PDF generation.

---

## 6. Stop conditions
Same as GOAL.md §9. The real-material thresholds count toward done only if `test-material/`
exists; otherwise the synthetic fallback applies and the gap is noted in `NEEDS_HUMAN.md`.

---

## 7. Final report (`REPORT_2.md`)
1. A plain-English answer to "does speech-to-text hear what I actually say now?" Include the
   root causes found in P1, with evidence.
2. The same for OCR: "is it reading my bill, or returning preset values?"
3. Harness results in a table (real or synthetic), against the thresholds.
4. A task table with done / partial / blocked and commit hashes.
5. Test counts: backend, Playwright, harness.
6. Live API calls used against the budget.
7. Migrations written and applied.
8. The top 5 remaining risks.
9. What Maanit must do himself: a short, ordered list copied from `NEEDS_HUMAN.md`.
