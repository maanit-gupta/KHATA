# GOAL.md: Finish and harden KHATA (autonomous run)

You are running **unattended for a long session**. Nobody will answer questions until you finish.
Your job is to take KHATA from "hackathon demo" to "complete and correct against the spec,"
working through the queue below in order, committing as you go, and leaving an honest written
record of what you did, what you decided, and what still needs a human.

Source of truth, in priority order:
1. This file
2. `CLAUDE.md` (product/build spec)
3. `DESIGN.md` (visual spec)
4. `docs/sarvam-notes.md` and `docs/groq-notes.md` (verified API behaviour)

Where they disagree, the higher one wins. Log every conflict you find in `DECISIONS.md`.

---

## 0. Definition of done

The run is complete when **all** of these are true, or when a stop condition in §9 is hit:

- Every task in §5 (P1–P9) is done and its acceptance criteria are checked off in `PROGRESS.md`,
  or is explicitly moved to `NEEDS_HUMAN.md` with the reason.
- `cd backend && .venv/bin/pytest -q` passes with zero failures and zero skips.
  (Tests that need real accounts create and delete throwaway users, per CLAUDE.md §9b.)
- `cd frontend && npm run build && npm run lint && npx tsc --noEmit` pass with zero errors.
- The Playwright suite (added in P8) passes locally against mocked APIs.
- `README.md` "Status" section is accurate, line by line, with no claims that aren't true.
- A final report is written to `REPORT.md` (format in §8).

---

## 1. Operating rules

### 1.1 Autonomy
- **Do not ask questions and do not wait for input.** When the spec is unclear, choose the
  option that is (a) safest for the user's money and data, then (b) simplest, then (c) closest
  to the spirit of CLAUDE.md. Record it in `DECISIONS.md` as:
  `D-### | date | question | options considered | choice | why`.
- If a task is truly blocked (needs a credential you don't have, a paid plan, a dashboard click,
  or a product decision with real trade-offs), write it to `NEEDS_HUMAN.md` with the exact action
  needed and move on to the next task. Never stall.

### 1.2 Safety rails (never break these)
- **Git:** create and work on branch `goal/complete-khata`. Commit after every finished task with
  message `P#.#: <what>`. **Never push to `main`, never force-push, never rewrite history.**
  Pushing the branch itself is fine. Do not merge.
- **Deploys:** do not deploy, and do not change Vercel/Render settings. Deploy-related work produces
  files and checklists only.
- **Database:** the Supabase project in `.env` is live.
  - Schema changes go in new numbered files in `migrations/` (`002_...sql`, `003_...sql`).
  - You may apply a migration to the live project **only if it is purely additive**: a new
    table, a new nullable column, a new index, a new or replaced function/view/trigger/policy
    that does not loosen access.
  - Never drop, rename, or change the type of anything. Never delete rows except throwaway test
    data you created in the same test. Never disable RLS.
  - If a change can't be made additively, write the migration file, don't apply it, and log it in
    `NEEDS_HUMAN.md`.
- **Other projects:** touch only this repo and the Supabase project named in `.env`. Ignore
  advisories about other projects.
- **Secrets:** never print, log, commit, or paste keys or tokens. `.env*` stays gitignored. If you
  find a secret in git history or code, log it in `NEEDS_HUMAN.md` as a rotation task; don't try to
  rewrite history.
- **Money guards:** the core invariants in CLAUDE.md are non-negotiable:
  - integer paise
  - balances only from the `party_balances` view
  - no LLM decides a save (`decide_save` stays deterministic)
  - every number spoken or shown comes from SQL
  - entries are voided, never deleted
  Any change that touches these needs a test proving the invariant still holds.

### 1.3 API budget
Sarvam credits are limited. Automated tests **must mock** Sarvam and Groq.
- **Live calls allowed:**
  - Sarvam: at most **40 calls total** for the whole run, counting STT, TTS, translate and
    Document AI separately.
  - Groq: at most **60 calls total**.
- Keep a running tally in `PROGRESS.md`.
- Save raw live responses (with any secrets stripped) to `backend/tests/fixtures/live/` so you can
  build mocks from real shapes instead of spending more calls.
- On any 402, quota, or credit error, stop all live calls, log it in `NEEDS_HUMAN.md`, and continue
  with mocks.

### 1.4 Working style
- **Read before you write.** At the start of each task, re-read the spec sections it cites and the
  code it will touch.
- **Root cause first.** For bugs, reproduce the problem, find the cause, fix only that, and add a
  regression test.
- **Keep diffs small and in scope.** Don't refactor working code unless the task says to.
- Use the existing design-system components. Don't create parallel ones.
- Screenshot every UI you change at **390px and 1280px** (Playwright) and compare it to DESIGN.md.
  Save them to `artifacts/screens/<task>/`.

---

## 2. Read first (in this order, fully)

1. `CLAUDE.md` (all of it, especially §3, §4, §5, §6, §6.5, §8, §9b, §12, §12b)
2. `DESIGN.md` (all of it)
3. `docs/sarvam-notes.md` and `docs/groq-notes.md`
4. `README.md` (the Status section lists what the hackathon build left unfinished)
5. `schema.sql` and everything in `migrations/`
6. The whole `backend/` and `frontend/src/` trees

The hackathon build ran in "deadline mode": it cut corners, skipped tests, and may deviate from
the spec. **Assume nothing is correct until checked.**

---

## 3. Phase 0: Audit (do this before changing anything)

Produce `AUDIT.md`, a table of every requirement in CLAUDE.md §3–§9b, §6.5 and §12 and every
screen in DESIGN.md §6–§7, with columns:
`Requirement | Spec ref | Status (done / partial / missing / wrong) | Evidence (file:line or test) | Task`.

Then:
1. Run the full backend test suite, the frontend build, lint and typecheck. Record every failure.
2. Check the live database matches `schema.sql` + migrations. Specifically confirm:
   - the `shop_members_no_tamper` trigger exists (migration 001);
   - RLS is enabled on every table;
   - both views have `security_invoker`.
   Read-only queries only.
3. Compare every endpoint in the code against the §6.5 API table: path, method, body, response
   shape, and error shape.
4. List every deadline-mode shortcut you find (sync OCR, no `/voice/entry/resolve`, no clarify
   join, missing retries, placeholder screens, hardcoded strings outside `en.ts`, `--muted` used
   for important text, TODOs).
5. Add a task to §5 for anything the audit finds that isn't already covered (append as `P#.x`).

Commit `AUDIT.md` as `P0: audit`.

---

## 4. Known facts from the hackathon build

- **Working:** auth, create/join shop with invite code, per-user language, voice entry with
  read-back and 5s Undo, manual add, confirm/void, parties with balances, party detail.
- **Broken:** receipt auto-fill. The Sarvam Document AI extract job completes but returns an
  **empty result**, so values are typed by hand.
- **Missing:** voice questions, weekly insights, review queue, entry edit + history screen,
  settings (language/voice/invite code), public landing page, `/voice/entry/resolve`, the clarify
  answer-join, receipt English retry, background OCR.
- **Deployed:** frontend on Vercel (`khata-alpha.vercel.app`), backend on Render (free tier,
  cold starts).
- **Security:** a test login (`demo-walk@example.com`) was shared publicly. Log in `NEEDS_HUMAN.md`
  that its password should be changed after judging. Don't change it yourself.

---

## 5. Work queue (strict priority order)

Each task has acceptance criteria (AC). A task is done only when every AC is verified and the
evidence is noted in `PROGRESS.md`.

### P1: Correctness and security foundation
**P1.1 Test suite green.** Fix every failing test found in the audit. Fix the code when the code
is wrong; fix the test only when it contradicts the spec.
- AC: pytest shows 0 failed, 0 skipped.

**P1.2 Tenant isolation proof.** Write `backend/tests/test_isolation.py`. With two throwaway
users in two shops, prove that user A can neither read nor write shop B's data through **every**
endpoint in §6.5 and **every** table via the user-scoped client. Also cover the storage media
endpoints: A cannot get a signed URL for B's audio or receipt.
- AC: all pass; the test list covers every endpoint in §6.5.

**P1.3 Membership tamper.** Test that a member cannot change their own `shop_id`, `user_id` or
`role` (migration 001). If the trigger is missing on the live DB, apply migration 001 (it's
additive).
- AC: test passes against the live DB.

**P1.4 Money invariants.** Tests for:
- balance math across all 7 entry types;
- voided entries excluded;
- an edit that changes amount, type or party moves the balance correctly;
- rupee↔paise conversion at the API boundary (for example ₹0.10, ₹1,250.50, ₹5,000 and
  ₹5,000.01 against the auto-save cap);
- en-IN formatting in the frontend (unit test).
- AC: all pass. The ₹5,000.01 case requires a tap.

**P1.5 Timezone.** Every date (`occurred_on`, "today" sent to the LLM, the week boundary) is
computed in Asia/Kolkata (CLAUDE.md §9b). Test a voice entry at 23:30 UTC, which is the next day
in IST.
- AC: test passes; no `datetime.utcnow()` or naive `date.today()` remains in the backend (grep
  proves it).

**P1.6 Audit trail.** Confirm the trigger logs create/edit/confirm/void with before/after and the
actor for user-scoped requests.
- AC: test passes for each action.

**P1.7 Error shape and retries.** Every non-2xx response uses `{error:{code,message}}` with a
plain-English message. Sarvam and Groq calls retry on 429/503 with backoff 1s/2s/4s, max 3
attempts, then fail cleanly with nothing saved (CLAUDE.md §8).
- AC: tests with mocked 429 and 503 responses.

### P2: Fix receipt auto-fill (the known broken feature)
**P2.1 Reproduce.** Write `backend/scripts/debug_receipt.py`. It runs one receipt image through
the exact production code path and saves the raw Sarvam response to
`tests/fixtures/live/receipt_*.json`. Use at most 3 live Document AI calls for diagnosis.

**P2.2 Find the root cause.** Check each of these against `docs/sarvam-notes.md` and the Sarvam
docs MCP:
- the extract schema format;
- where the results live (inline vs a downloaded output file or ZIP);
- output format settings;
- the language code;
- image vs PDF input requirements;
- whether results are read before the job is truly finished.
Record the cause in `DECISIONS.md`.

**P2.3 Fix it.** Implement the correct flow.
- If extract can't return the fields reliably, the fallback is: Document AI **digitise** to
  markdown, then Groq (`gpt-oss-20b`, strict json_schema) pulls out `{vendor_name, bill_date,
  total}` from that text.
- Add a **number guard**: the extracted total must literally appear in the OCR text. If it
  doesn't, leave the total empty for the user to type.
- Log the choice.

**P2.4 Make it background work, per spec.** POST /receipts returns the `receipt_id` immediately.
A FastAPI BackgroundTask polls every 2s with a 90s timeout. Do the English retry only under the
CLAUDE.md §6.3 conditions. The frontend polls GET /receipts/{id} every 2s.
- AC: mocked tests for success, first-try failure then English success, double failure, and a
  total not found in the text. One live end-to-end run on a real receipt fills at least 2 of the 3
  fields. The status page line in the README is updated.

### P3: Finish voice entry to spec
**P3.1** Build `POST /voice/entry/resolve` for "Did you mean X?" (`use_suggested` /
`create_new`), with the UI chips from DESIGN.md §6.6.

**P3.2** Clarify flow: the answer recording joins with the first transcript
(`first + " " + answer`) and is re-parsed (CLAUDE.md §9b). The UI shows the question text plus
a HOLD TO ANSWER button.

**P3.3** Recording edge cases:
- presses under 0.7s show a toast;
- the 30s auto-send works;
- microphone permission denied shows an instruction screen;
- Safari's MP4 recordings are accepted by the backend (test with a fixture).

**P3.4** Read-back and clarify questions are always composed in English and passed through
`localize_for_speech`.
- AC: tests for resolve (both choices), clarify join, and each save decision end to end with
  mocks.

### P4: Voice questions (Q&A)
**P4.1** Implement `tools_impl` for all 5 read-only QA_TOOLS as SQL through the user-scoped
client. Inject `shop_id` server-side. Amounts go to the model in rupees, with the unit in the key
(`balance_rupees`).

**P4.2** Build `POST /voice/ask` via `voice_question_pipeline`. Store the audio and a
`voice_notes` row with `purpose='question'`.

**P4.3** Frontend: HOLD TO ASK with the same recording visuals, and an answer card showing the
text with auto-played audio.
- AC (mocked LLM transport, real tools against seeded data):
  - every number in a final answer appears in a tool result;
  - "delete Ramesh's entry" gets the "use the Add button" reply;
  - ambiguous names trigger "which one?";
  - no write happens during Q&A (assert the row counts are unchanged).

### P5: Screens the spec requires
**P5.1 Review queue** (DESIGN.md §6.10): pending entries (confirm/edit), auto-created parties
(rename, merge via `POST /parties/{id}/merge`), failed receipts (enter manually). The REVIEW nav
chip shows a count.

**P5.2 Entry edit + history** (§6.11): every field editable, and the history from `audit_log`
shows "You" / "Another member", the time, and old → new. VOID asks for confirmation.

**P5.3 Settings** (§6.12):
- change language (PATCH /me);
- voice picker with `varun` hidden, where selecting a voice plays the sample "Ramesh owes you
  250 rupees." in that language via POST /tts;
- invite code with a COPY chip, visible to all members;
- log out.

**P5.4 Party detail evidence:** ▶ plays the original audio through a signed URL; → opens the
receipt image. Balance wording is always explicit ("OWES YOU ₹X" / "YOU OWE ₹X").
- AC: each screen screenshotted at 390/1280, and every action covered by a Playwright test
  (mocked API).

### P6: Weekly insights
Build GET /insights/weekly per CLAUDE.md §6.4:
- SQL metrics for the current Mon–Sun week (IST) vs the previous week;
- a cache in `weekly_insights` that recomputes if older than 15 min;
- amounts converted to rupees before `narrate_insights`;
- localization with the number guard.
The frontend shows the "This week, so far." block with a play control.
- AC: tests against hand-computed fixtures, including an empty week and a week spanning a month
  boundary.

### P7: Landing page and design fidelity
**P7.1** Build the public landing page at `/` exactly per DESIGN.md §7, with the full landing
motion from §8. Include the six "Say it your way" lines with a `TODO: native-speaker check`
comment. Render BuiltBy only if `public/founder.jpg` exists.

**P7.2 Design pass.** Walk every screen against DESIGN.md §1–§6 and fix deviations:
- radius 0, no shadows or gradients, no icon libraries, weight 400 only;
- `--muted` never used for amounts, names or errors;
- the status squares language;
- the recording and undo countdown hairlines;
- page transitions;
- the 900px split layout;
- the MENU overlay.

**P7.3 Reduced motion** matches DESIGN.md §8 exactly. Countdown hairlines still animate, linearly.
- AC: a before/after screenshot for each fix; a Playwright test with
  `prefers-reduced-motion: reduce` asserts no ripple animation is running.

### P8: Hardening and quality
**P8.1 Offline and errors:**
- the full-screen offline overlay with RETRY (DESIGN.md §6.13);
- every API error shows its plain message;
- no apologetic copy anywhere (grep for "sorry").

**P8.2 Accessibility:**
- keyboard-only walkthrough of every screen;
- visible square focus rings;
- 48px minimum tap targets;
- labelled fields;
- `aria-live` on result, answer and undo toasts;
- decorative squares marked `aria-hidden`.

**P8.3 Performance:**
- lazy-load the landing page and non-critical screens;
- report the frontend bundle size in `PROGRESS.md`; the main chunk should be under 250 KB
  gzipped, or explain why not;
- React Query cache settings so going back to the Ledger doesn't refetch everything.

**P8.4 Playwright e2e** (mocked backend via route interception): signup → onboarding → manual
entry → voice entry (inject an audio fixture) → confirm/undo → parties → party detail → scan with
a mocked OCR → review queue → settings. Runs headless and passes.

**P8.5 Security sweep:**
- grep for secrets and token logging;
- CORS allows only `ALLOWED_ORIGINS`;
- the secret key is used only where CLAUDE.md §10 allows;
- upload size and MIME limits are enforced server-side (10 MB; audio and image types only);
- rate-limit the voice, receipt and TTS endpoints per user (a simple in-memory token bucket is
  fine; log the choice).

**P8.6 Render cold start:** add a lightweight `/health` keep-warm note to DEPLOY.md. On the
frontend, show a "Waking the server…" state if the first request takes over 3 seconds.

### P9: Docs and handoff
- **README.md:** accurate Status checkboxes, setup steps verified by actually following them from
  a clean clone in a temp dir, and the test commands.
- **DEPLOY.md:** an ordered checklist including the migrations to apply and the env vars.
- **DEMO.md:** a 3-minute demo script with a fallback line for each step.
- **CLAUDE.md:** update only where you made a logged decision that changes the spec (cite the
  D-###).

### Stretch (only after P1–P9 are all done)
- Fuzzy-match threshold tuning. Build a small evaluation set of about 40 Indian names with
  common STT variants (Ramesh/Rakesh, Suresh/Sureesh, Lakshmi/Laxmi). Report precision and recall
  at the current thresholds and propose new values **in DECISIONS.md only**; don't change them.
- Prime saaras with the shop's party names, if docs/sarvam-notes.md confirms support. Put it
  behind a feature flag that defaults off.

---

## 6. Out of scope (do not build)
Payment reminders and WhatsApp, offline queuing, line items, inventory, GST, UI translation into
other languages (UI stays English per CLAUDE.md §2), native apps, changing the stack, paid
services, and deploying.

---

## 7. Files you maintain during the run
| File | Purpose | Update when |
|---|---|---|
| `PROGRESS.md` | Task checklist with AC ticks and evidence, plus the live API call tally | after every task |
| `DECISIONS.md` | Every judgement call (D-### format, §1.1) | whenever you choose |
| `NEEDS_HUMAN.md` | Blocked items, with the exact action needed | whenever blocked |
| `AUDIT.md` | The Phase 0 gap table; update the status column as tasks close | Phase 0, then as you go |
| `REPORT.md` | The final report | at the end |

---

## 8. Final report (`REPORT.md`)
1. A one-paragraph summary of the state of the app now.
2. A table of tasks with done / partial / blocked and the commit hash for each.
3. Test results: backend pass count, Playwright pass count, build/lint/typecheck status.
4. The live API calls used (Sarvam / Groq) against their budgets.
5. Migrations written, which were applied, and which await a human.
6. The top 5 remaining risks, ranked.
7. Everything in `NEEDS_HUMAN.md`, summarised as a to-do list for Maanit.

Be honest. Don't claim anything you didn't verify.

---

## 9. Stop conditions
Stop, write REPORT.md, commit, and push the branch when any of these happens:
- the definition of done (§0) is met;
- the live API budget is exhausted **and** every remaining task needs live calls;
- the same failure persists after 3 genuinely different fix attempts on a task (log it in
  `NEEDS_HUMAN.md` and continue with the next task first; stop only if every remaining task is
  blocked);
- continuing would require breaking a rule in §1.2.
