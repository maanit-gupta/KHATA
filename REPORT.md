# REPORT.md: GOAL.md run, 26 September 2026

Branch `goal/complete-khata` (base `4b86e02`). Not merged, not deployed.

## 1. Summary

Every task P1–P9 and both stretch items are done. Everything in CLAUDE.md §6.5 now exists: 25
routes, each covered by a tenant-isolation test. That includes routes the hackathon build
lacked: voice questions, did-you-mean resolve, entry edit with audit history, party
rename/merge, review queue, weekly insights, TTS and signed media. Every screen in DESIGN.md
§6–§7 is built, the public landing page included.

Receipt reading now runs in the background with the English retry and a digitise + Groq
fallback guarded by a number check. The original "empty result" bug could not be reproduced.
All three live diagnosis jobs, including the hackathon's own code, returned all three fields.
The most likely causes are in D-011, and the new flow removes both. A live end-to-end run filled
3/3 fields, but on a synthetic bill, not real paper.

The money rules hold, each with tests: integer paise, balances only from `party_balances`,
deterministic `decide_save`, numbers from SQL, void not delete. Two new server-side guards
refuse any spoken or shown number that didn't come from SQL (Q&A answers and weekly
narrations).

The run found and fixed four real bugs beyond the queue:
- client-side links to `/demo` hit the 404 route;
- server 500s had no CORS headers, so the browser would show "No internet";
- a valid token used within a second of login could be refused because of clock skew;
- the P1.2 "every route is covered" test was passing trivially: FastAPI 0.141 hides routes
  inside `_IncludedRouter`.

What still needs a person:
- apply migration 002 (no DDL access in this run);
- confirm which Supabase project production uses;
- test real paper bills;
- a native speaker's check of the translated read-backs;
- landing-page content;
- rotate the shared demo login.

## 2. Tasks

| Task | State | Commit | Notes |
|---|---|---|---|
| P0 Audit | done | `5beb8ff` | `AUDIT.md`; statuses updated as tasks closed |
| P1.1 Suite green | done | `83075c7` | teardown fixed (audit FK, D-003) |
| P1.2 Tenant isolation | done | `83075c7`, `273aef1` | all 25 routes, every table/view, Storage; meta-test fixed to see real routes (D-040) |
| P1.3 Membership tamper | done | `83075c7` | shop_id / user_id / role blocked on the live DB |
| P1.4 Money invariants | done | `83075c7` | + en-IN formatting unit test (`e2e/unit.spec.ts`) |
| P1.5 Timezone | done | `83075c7` | 23:30 UTC entry → next IST day; grep test for naive clocks |
| P1.6 Audit trail | done | `83075c7` | create/edit/confirm/void with actor and before/after |
| P1.7 Error shape + retries | done | `83075c7` | 1/2/4 s backoff (D-004), mocked 429/503 |
| P1.8 Input validation (audit) | done | `83075c7` | foreign party ids, kinds, UUIDs, dates |
| P2.1 Reproduce | done | `238c55d` | 3 live diagnosis jobs saved to `tests/fixtures/live/` |
| P2.2 Root cause | done (not reproducible) | `238c55d` | D-011 |
| P2.3 Fix + number guard | done | `238c55d` | D-012 |
| P2.4 Background + polling | **partial** | `238c55d` | Everything built and tested; the live E2E filled 3/3 fields on a *synthetic* bill (D-017). Real paper: N-005 |
| P2.5 Idempotent save (audit) | done | `238c55d` | DB guard is migration 002 (not applied) |
| P3.1–P3.4 Voice entry to spec | done | `9c5d91e` | resolve, clarify join, MP4, mic screen, localized read-backs |
| P4.1–P4.3 Voice questions | done | `9c5d91e` | + answer number guard (D-020); live-checked with real Groq tool calls |
| P5.1–P5.4 Screens | done | `a13b3e6` | review, entry edit/history, settings, party evidence |
| P6 Weekly insights | done | `4c64498` | month-boundary + empty-week fixtures |
| P7.1 Landing page | done | `372b972` | BuiltBy hidden until a photo exists |
| P7.2 Design pass | done | `6df1d43` | before/after screenshots for 8 scenes |
| P7.3 Reduced motion | done | `372b972` | Playwright asserts no ripple, linear countdown |
| P8.1 Offline + errors | done | `dc0c935` | overlay + RETRY, plain messages, no "sorry" |
| P8.2 Accessibility | done | `dc0c935`, `2952d72` | axe on 11 screens, keyboard walk of every screen, 48 px targets |
| P8.3 Performance | done | `dc0c935` | main chunk 85.4 KB gzip (was one 205 KB-gzip chunk) |
| P8.4 Playwright e2e | done | `dc0c935` | `e2e/journey.spec.ts`, signup → settings |
| P8.5 Security sweep | done | `dc0c935`, `273aef1` | rate limits, CORS, secret-key use, logging; 2 bugs fixed (D-038, D-043) |
| P8.6 Cold start | done | `dc0c935` | "Waking the server…" + DEPLOY.md keep-warm |
| P9 Docs and handoff | done | `273aef1` | README (setup verified from a clean clone), DEPLOY.md, DEMO.md, CLAUDE.md §14 |
| P9.1 Demo mode (audit) | done | `273aef1` | every screen works in `/demo` |
| Stretch: fuzzy thresholds | done | `273aef1` | precision 0.95, recall 0.47; proposal in D-044, no code change |
| Stretch: STT priming | done (flag off) | `273aef1` | saaras:v4 only, so it sits behind `STT_PRIME_PARTY_NAMES` (D-045) |

`dc0c935` is a work-in-progress commit ("WIP P8/P9") made before the P8 tests had been run.
Its tests were run and fixed in `273aef1` and `2952d72`. History was not rewritten.

## 3. Test results (final code)

| Check | Result |
|---|---|
| `cd backend && .venv/bin/pytest -q` | **216 passed, 0 failed, 0 skipped** (557 s). Sarvam and Groq faked in every test; live Supabase with throwaway users, cleaned up (0 users / 0 shops left) |
| `npx playwright test` | **58 passed**, headless, mocked API + Supabase Auth (also 47/47 on an earlier clean-clone run) |
| `npm run build` | OK; main chunk 275.3 KB (85.4 KB gzip) |
| `npm run lint` (oxlint) | 0 errors, 0 warnings (was 4 warnings) |
| `npx tsc --noEmit` | exit 0. The root tsconfig only lists project references, so this checks nothing on its own. `npm run typecheck` (`tsc -b` + e2e config) is the real check: exit 0 |

Caveat: during the run a network outage broke two backend runs midway (hung SSL reads, server
disconnects). The final run above was clean. The backend suite depends on the live Supabase
project being reachable.

## 4. Live API calls

| Service | Used | Budget | Where |
|---|---|---|---|
| Sarvam | **34** | 40 | Receipt diagnosis 17 (3 extract jobs, status polls counted), receipt E2E 11, voice check 6 (2 STT, 2 translate, 2 TTS) |
| Groq | **4** | 60 | Voice check: 1 parse + 3 Q&A turns |

No 402/quota errors. Raw responses (no keys) are in `backend/tests/fixtures/live/`.

## 5. Migrations

| File | Additive | Applied to the `backend/.env` project |
|---|---|---|
| `001_lock_shop_members.sql` | yes | Already applied before this run; the live tamper tests pass |
| `002_one_live_entry_per_receipt.sql` | yes (partial unique index) | **Not applied.** This run had no DDL access: the Supabase MCP connector couldn't see this project (D-002). The app already refuses a second save; the index closes the double-tap race. N-004 |

## 6. Top 5 remaining risks (ranked)

1. **Production may not be the project this run tested.** The project in `backend/.env` had 0
   users and 0 shops, and the shared demo login doesn't exist in it. If Render/Vercel point at
   another project, that one needs migration 001/002 checks too (N-003).
2. **Real bills are untested.** OCR was verified live on a synthetic printed bill and a
   phone-style photo only. Handwritten and faded thermal bills may still come back empty; they
   then fall to the review queue for manual entry, and nothing wrong is saved (N-005).
3. **Background OCR on the free Render instance.** A sleeping or restarting instance loses the
   job (reported as failed after 5 minutes, D-015). The user token is only valid for about an
   hour, and rate limits are per instance (D-037).
4. **Translated read-backs.** Mayura's colloquial mode gives code-mixed Hindi. Numbers are
   guarded, but naturalness and wording like "के पास" (has vs owes) need a native speaker
   (N-009).
5. **Name matching.** 3 of 38 spelling variants (Laxmi, Gita, Mina) would create duplicate
   parties, and one different person (Vijaya) auto-matched Vijay. Phonetic normalisation is
   proposed in D-044, not built.

## 7. To-do for Maanit (from NEEDS_HUMAN.md)

- [ ] **N-007** Review `goal/complete-khata`, merge to `main`, then follow DEPLOY.md.
- [ ] **N-003** Check `SUPABASE_URL` on Render and `VITE_SUPABASE_URL` on Vercel point at the project in `backend/.env` (it currently has no users).
- [ ] **N-004** Run `migrations/002_one_live_entry_per_receipt.sql` in the Supabase SQL editor.
- [ ] **N-002** Run `scripts/verify_db.sql` and check every row is `true` (RLS on every table, `security_invoker` views, triggers, private buckets).
- [ ] **N-001** Change the password of (or delete) the shared `demo-walk@example.com` login.
- [ ] **N-005** Scan 3–5 real bills (thermal, handwritten, faded) and note which fields fill.
- [ ] **N-009** Have a native speaker listen to the Hindi/Tamil read-backs; pick the translate mode.
- [ ] **N-006** Add `frontend/public/founder.jpg` + 4 bio lines, the hackathon's name, and a native-speaker check of the six "Say it your way" lines.
- [ ] **N-008** Delete the 4 orphaned pre-run recordings in the `voice` bucket if they're test leftovers.
