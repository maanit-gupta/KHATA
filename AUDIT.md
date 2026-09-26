# AUDIT.md: Phase 0 gap table

Audit date: 2026-09-26 (IST). Branch `goal/complete-khata`, base commit `4b86e02`.
Status values: **done** / **partial** / **missing** / **wrong**. The `Task` column points at the
GOAL.md §5 task that closes the gap (`P#.x` = task added by this audit). The status column is
updated as tasks close. The original Phase 0 status is kept in brackets when it changed.

## A. Baseline checks (before any change)

| Check | Result |
|---|---|
| `backend/.venv/bin/pytest -q` | 15 passed, 0 failed, 0 skipped (35 s, live Supabase) |
| `npm run build` | OK. One JS chunk, 688.6 KB (205.3 KB gzip). Vite warns >500 KB minified. |
| `npm run lint` (oxlint) | 0 errors, 4 warnings (`set-state-in-effect` ×2, `only-export-components` ×2) |
| `npx tsc --noEmit` | exit 0, but the root `tsconfig.json` has `files: []`, so it checks **nothing**. `tsc -b` inside `npm run build` is the real check and passes. |
| Test cleanup | **Bug.** `conftest.Users.cleanup()` deletes shops, but `audit_log.entry_id` has no `ON DELETE CASCADE`, so any test that creates an entry leaves its shop and user behind (FK violation 23503). The existing tests never create entries, which is why it went unnoticed. → P1.1 |
| Live DB access | The Supabase MCP connector in this session only sees two unrelated projects (not `yspgbhgjdwbmxpnkgoeu`). No SQL/DDL access, so catalog checks were done **behaviourally** through PostgREST (below) and the SQL checks are handed to a human (NEEDS_HUMAN N-002). |
| Live DB contents | 0 auth users, 0 shops in the project in `backend/.env`. Buckets `voice` and `receipts` exist and are **private**. |
| Secrets in git | `git log -p --all` scanned for `sb_secret_`, `gsk_`, `sk_`, JWTs: none. `.env*` untracked. |

## B. Live DB vs `schema.sql` + migrations (behavioural probe, throwaway users, cleaned up)

| Requirement | Evidence | Status |
|---|---|---|
| RLS enabled on every table | Publishable key with no user token read 0 rows from all 9 tables and 3 views while 2 shops held data. | done |
| Views `security_invoker` | User A reading `party_balances`, `daily_summary`, `review_queue` unfiltered got only shop A rows while shop B had rows. A non-invoker view would run as owner and leak. | done |
| `shop_members_no_tamper` trigger (migration 001) | `tests/test_shops.py::test_member_cannot_tamper_with_membership[shop_id|role]` pass against live DB. Trigger name not verifiable without SQL. | done (behaviour) |
| `find_party`, `is_member` functions | `find_party` RPC is used by voice/receipt code; not yet exercised by a test. | partial → P1.2/P3 |

## C. CLAUDE.md requirements

| Requirement | Spec ref | Status | Evidence | Task |
|---|---|---|---|---|
| Stack: React+Vite TS, FastAPI, Supabase | §1 | done | `frontend/package.json`, `backend/requirements.txt` | — |
| Locked libs (react-router, react-query, supabase-js, tailwind v4, framer-motion; fastapi, supabase, groq, sarvamai, httpx, PyJWT, python-multipart, pytest) | §1 | done | same | — |
| `PROMPTS.md` exists | §1 | missing | file not in repo; build steps are superseded by GOAL.md | (logged D-001) |
| Six languages, per-user `shop_members.lang` | §2 | done | `app/constants.py:3`, `routers/me.py` | — |
| STT translate mode with user lang, saaras:v3 | §2, §9b | done | `services/sarvam.py:39-43` | — |
| Translate with `numerals_format="international"` | §2 | done | `services/sarvam.py:46-51` | — |
| TTS in user lang + number guard fallback | §2 | done | `llm_router.localize_for_speech`, `routers/voice.py:_speak` | P3.4 tests |
| UI strings only in `strings/en.ts` | §2 | partial | Mostly. Hardcoded: `●` glyph `LedgerScreen.tsx:91`; `DevUI` (dev only, allowed). | P7.2 |
| Email+password auth, confirm off | §3 | done | `AuthScreen.tsx` | — |
| Owner = staff permissions | §3 | done | no role checks anywhere | — |
| One user → one shop | §3 | done | `one_shop_per_user` index; `test_member_cannot_create_or_join_another_shop` | — |
| Onboarding step 1 / step 2, en-IN preselected for joiners | §3 | done | `OnboardingScreen.tsx:69` | — |
| Invite code visible to owner and staff in Settings | §3 | partial | `/me` returns it (test), Settings screen not built | P5.3 |
| Display name in auth metadata; history shows "You"/"Another member" | §3 | partial | metadata set at signup; history not built | P5.2 |
| Backend verifies token (JWKS, cached), user-scoped client | §3, §10 | done | `app/auth.py`, `app/db.py`; `tests/test_auth.py` | — |
| Secret key only for /shops, /shops/join, Storage | §3, §10 | done | `admin_client()` used in `shops.py`, `voice.py:67`, `receipts.py:71` | P8.5 recheck |
| 7 entry types, integer paise | §4 | done | `schema.sql`, `ledger.py:10` | P1.4 tests |
| Balances only from `party_balances` | §4 | done | `routers/parties.py` | P1.4 tests |
| Rupees→paise at API boundary is exact | §4, §6.5 | done [wrong] | `round(float*100)`; accepts 3+ decimals (₹10.005 silently rounds) | P1.4 |
| Entries editable (amount, type, party, date, note) | §4 | done (API) [missing] | no `PATCH /entries/{id}` | P5.2 |
| Every insert/update logged by trigger | §4 | done | `schema.sql` `log_entry_change`; audit_log readable via RLS (probe) | P1.6 tests |
| Never deleted; delete = void | §4 | done | `POST /entries/{id}/void`; no delete route | — |
| `decide_save` deterministic, thresholds 0.6/0.15/0.3, cap ₹5,000 | §5 | done | `llm_router.py:decide_save` | P3.4 tests |
| New party `name_latin` = English transcript lowercased+trimmed | §5, §9b | done | `voice.py:99-101` | P3 tests |
| Clarify: save nothing, speak question | §5.1 | done | `voice.py:90-93` | P3.4 tests |
| Did-you-mean card, no new party created | §5.2, §12 | partial | pending entry created with the suggested party; no `/voice/entry/resolve`, no chips | P3.1 |
| Auto-save + Undo 5 s | §5.4 | done | `LedgerScreen.tsx`, `Toast.tsx` | — |
| Hold to record 30 s cap, countdown, 0.7 s min | §6.1 | partial | `useHoldRecorder.ts` has cap/min; hairline never turns white at 25 s | P3.3, P7.2 |
| Audio → `voice` bucket + `voice_notes` row | §6.1 | done | `voice.py:65-69` | — |
| MediaRecorder WebM/MP4 sent as-is | §6.1 | partial | MP4 accepted by MIME map; no server-side size limit; unknown MIME silently stored as .webm | P3.3, P8.5 |
| Result card + TTS read-back | §6.1 | done | `LedgerScreen.tsx:ResultCard` | — |
| Voice question pipeline, read-only tools, shop_id injected | §6.2 | missing | `voice_question_pipeline` exists in router but no tools_impl, no route | P4 |
| Receipt scan: kind, Paid/Credit or Cash/Udhaar | §6.3.1-2 | done | `ScanScreen.tsx` | P7.2 visuals |
| Receipt image in `receipts` bucket | §6.3.3 | done | `receipts.py:71` | — |
| Document AI extract, poll 2 s, 90 s timeout | §6.3.4 | done [wrong] | synchronous inside the request, 60 s timeout; results come back empty | P2 |
| English retry on failure/empty total or date | §6.3.5 | done [missing] | `retried_in_english` never set | P2.4 |
| Failed OCR → status failed, review queue, manual entry | §6.3.5 | done (API) [partial] | status failed set; review queue screen missing; saving manually leaves the receipt `failed` forever (stays in queue) | P2.4, P5.1 |
| Editable vendor/date/total before save | §6.3.6 | done | `ScanScreen.tsx` form | — |
| Kind → entry type mapping | §6.3.7 | done | `receipts.py:_entry_type` | P2 tests |
| customer+udhaar asks for customer name | §6.3.7 | done | `receipts.py:134` | — |
| Save rules apply to receipts | §6.3.8 | done | `receipts.py` uses `decide_save` | P2 tests |
| `raw_extract` keeps full OCR JSON | §6.3 | done | `receipts.py:92` | — |
| Receipt save is idempotent | (implied §4) | done [wrong] | a double tap on Save creates two entries for one bill | P2.5 (new) |
| Weekly summary card, Mon–Sun IST, cached, SQL metrics, rupees to narrate | §6.4, §9b | missing | no route, no UI | P6 |
| API: every route in §6.5 | §6.5 | partial | see section D | P1–P6 |
| Error shape `{error:{code,message}}` | §6.5 | partial | handlers in `errors.py`; but bad UUID/enum/date inputs reach PostgREST and come back as a 500 "Something went wrong" | P1.7, P1.8 (new) |
| Routes and guards `/app/*` | §7 | done | `App.tsx`, `auth/guards.tsx` | — |
| Landing page at `/` | §7 | missing | `/` redirects to `/login` (`App.tsx:35`) | P7.1 |
| Offline overlay + RETRY | §8 | missing | fetch failure → inline message only | P8.1 |
| 429/503 retry 1 s/2 s/4 s then "Service busy", save nothing | §8 | done [wrong] | Sarvam: 1 retry after 1 s (`sarvam.py:_call`); Groq: SDK default 2 retries with its own backoff, no "Service busy" mapping (a Groq 429 becomes a 500) | P1.7 |
| Mic permission denied → instruction screen | §8 | partial | one-line inline error | P3.3 |
| Private buckets, `{shop_id}/{uuid}.{ext}` | §9 | done | probe: both buckets `public=False`; paths in `voice.py:66`, `receipts.py:70` | — |
| Signed URLs 10 min | §9 | done (API) [missing] | no `/media` route | P5.4 |
| Asia/Kolkata everywhere | §9b | done | `ledger.py:today_ist`; grep finds no `utcnow`/`date.today` | P1.5 test |
| Default TTS voice per language; `varun` hidden | §9b | done | `constants.py` | P5.3 |
| Settings voice sample "Ramesh owes you 250 rupees." | §9b | missing | — | P5.3 |
| Read-back/clarify composed in English → localize | §9b | done | `voice.py:_speak` | P3.4 tests |
| Clarify answer join `first + " " + answer` | §9b | missing | — | P3.2 |
| `purchase_paid` receipt links supplier party; expense vendor → note | §9b | done | `receipts.py:128-157` | P2 tests |
| Python 3.12 pinned | §9b | done | `runtime.txt`, `render.yaml` | — |
| Tests create/delete throwaway users | §9b | done [wrong] | cleanup breaks once an entry exists (section A) | P1.1 |
| JWKS verification, no JWT secret | §10 | done | `auth.py` | — |
| `.env.example` files | §10 | done | both exist | — |
| Acceptance tests §12 (8 scenarios) | §12 | missing | none automated except isolation (partial) | P1–P3, P4 |
| Migration 001 applied | §12b | done (behaviour) | tamper tests pass | P1.3 |

## D. API table (§6.5) vs code

| Route | Code | Status | Notes |
|---|---|---|---|
| GET /health | `main.py:24` | done | |
| GET /me | `me.py:read_me` | done | |
| PATCH /me | `me.py:update_me` | done | |
| POST /shops | `shops.py:create_shop` | done | returns 201 |
| POST /shops/join | `shops.py:join_shop` | done | 404 `bad_invite_code` |
| GET /parties | `parties.py:list_parties` | done [partial] | `kind` not validated (bad value → 500); `q` matches display_name only |
| GET /parties/{id} | `parties.py:get_party` | done [partial] | non-UUID id → 500 |
| PATCH /parties/{id} | `parties.py:edit_party` | done [missing] | P5.1 |
| POST /parties/{id}/merge | `parties.py:merge_party` | done [missing] | P5.1 |
| GET /entries | `entries.py:list_entries` | done [partial] | `status` not validated (→ 500) |
| POST /entries | `entries.py:create_entry` | done [wrong] | accepts another shop's `party_id` (FK check ignores RLS, so a cross-tenant reference is stored); party kind not checked against type; `occurred_on` not validated (→ 500); float rounding |
| GET /entries/{id} | `entries.py:get_entry` | done [missing] | P5.2 |
| PATCH /entries/{id} | `entries.py:edit_entry` | done [missing] | P5.2 |
| POST /entries/{id}/confirm | `entries.py:confirm_entry` | done | |
| POST /entries/{id}/void | `entries.py:void_entry` | done | |
| POST /voice/entry | `voice.py:voice_entry` | partial | no clarify join, no size/MIME limit, Groq errors → 500 |
| POST /voice/entry/resolve | — | missing | P3.1 |
| POST /voice/ask | — | missing | P4 |
| POST /receipts | `receipts.py:create_receipt` | done [wrong] | synchronous OCR, returns the full receipt, not `{receipt_id}` + BackgroundTask |
| GET /receipts/{id} | `receipts.py:get_receipt` | done | |
| POST /receipts/{id}/save | `receipts.py:save_receipt` | done [partial] | not idempotent; leaves failed receipts in the queue |
| GET /insights/weekly | — | missing | P6 |
| POST /tts | `tts.py` | done [missing] | P5.3 |
| GET /review | `review.py` | done [missing] | P5.1 |
| GET /media/{bucket}/{id} | `media.py` | done [missing] | P5.4 |

## E. DESIGN.md screens (§6–§7)

| Screen / rule | Ref | Status | Evidence | Task |
|---|---|---|---|---|
| Login/Signup split | §6.1 | done | `AuthScreen.tsx`, `SplitLayout.tsx` | — |
| Onboarding split, 6 language rows | §6.2 | done | `OnboardingScreen.tsx` | — |
| Ledger voice panel: HOLD TO ADD, HOLD TO ASK, SCAN A BILL → | §6.3 | partial | only HOLD TO ADD + "Add by hand" | P4.3, P7.2 |
| Answer card with ▶ square | §6.3 | missing | — | P4.3 |
| "This week, so far." block | §6.3 | missing | — | P6 |
| Recent rows tap → Entry edit | §6.3 | wrong | rows open the party (`LedgerScreen.tsx:171`) | P5.2 |
| Recording: label, hairline 30 s, white at 25 s | §6.4 | partial | hairline is cyan and never turns white | P7.2 |
| Undo toast | §6.5 | done | `Toast.tsx` | — |
| Pending card CONFIRM → / EDIT; did-you-mean chips; clarify HOLD TO ANSWER | §6.6 | partial | Confirm + Void only | P3.1, P3.2 |
| Scan: tall kind cards, big chips, preview + RibbedGlass strip, dark form, SAVE ENTRY → | §6.7 | partial | chips only, no preview, light form, "Save" | P2.4, P7.2 |
| Parties: search + CUSTOMERS/SUPPLIERS chips | §6.8 | partial | list only | P7.2 |
| Party detail: H2 name, Amount-style balance, ▶ / → evidence | §6.9 | partial | balance is H2 line 2; no evidence controls | P5.4 |
| Review queue | §6.10 | missing | placeholder | P5.1 |
| Entry edit + history + VOID confirm | §6.11 | missing | placeholder | P5.2 |
| Settings | §6.12 | partial | LOG OUT only | P5.3 |
| Empty ledger copy + PixelSquares | §6.13 | wrong | "No entries yet. Hold the button and say one." | P7.2 |
| Offline overlay | §6.13 | missing | — | P8.1 |
| Landing (Hero, HowItWorks, PrinciplesSplit, SayItYourWay, BuiltBy, Footer) | §7 | missing | — | P7.1 |
| Nav chips LEDGER/PARTIES/REVIEW/SETTINGS + review count | §5 | wrong | extra SCAN chip; count never passed (`AppShell.tsx:137`) | P5.1, P7.2 |
| Radius 0, no shadows, weight 400 | §1 | done | global reset `index.css:114-118` | — |
| No icons except → and squares | §1 | wrong | `●` in hold button (`LedgerScreen.tsx:91`) | P7.2 |
| `--muted` never on amounts/names/dates/errors | §2 | wrong | dates in entry rows are `text-muted` (`LedgerScreen.tsx:174`) | P7.2 |
| Focus ring 2px square | §9 | done | `index.css:137` | P8.2 |
| Page transitions | §8 | done | `PageTransition.tsx` | — |
| Reduced motion (static ribs, instant reveals, linear countdowns) | §8 | done | `RibbedGlass.tsx`, `useReveal.ts`, `.countdown` | P7.3 test |
| 900px split | §4 | done | `Screen` in `AppShell.tsx` | — |

## F. Deadline-mode shortcuts found

1. **Synchronous OCR** in `POST /receipts` (60 s, blocks a worker; spec says BackgroundTask + 90 s).
2. **No `/voice/entry/resolve`**; the did-you-mean case leaves a pending entry and the UI offers only Confirm/Void.
3. **No clarify join**: an answer is parsed on its own.
4. **Retries**: Sarvam 1 retry; Groq relies on SDK defaults; a Groq 429 surfaces as a 500.
5. **Placeholder screens**: Review, Entry edit, Settings (log out only). `/` redirects to login.
6. **Input validation gaps**: UUIDs, enums, dates and foreign `party_id` reach Postgres unchecked.
7. **Test cleanup** can't delete shops with entries (audit_log FK), so no test ever wrote an entry.
8. **Hardcoded glyph** `●` outside `en.ts`; `--muted` on dates.
9. **Frontend has no tests** of any kind; no Playwright.
10. **`npx tsc --noEmit`** at the frontend root is a no-op (`files: []`).
11. **No upload limits** (size/MIME) on `/voice/entry` and `/receipts`; no rate limit.
12. **No TODO/FIXME comments** in app code; no "sorry" copy (grep clean).

## G. Tasks added by this audit
- **P1.8** Input validation: UUID path params, enum query params, ISO dates, `party_id` must belong to the caller's shop and match the entry type's party kind. Tests.
- **P2.5** Receipt save: idempotent (one entry per receipt, second save → 409) and marks a failed receipt `done` once saved by hand so it leaves the review queue.
- **P9.1** Demo mode (`/demo`): keep it working with the new screens (serve the new endpoints from the in-memory backend, or show a plain message where the demo can't).
