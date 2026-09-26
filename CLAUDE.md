# Kirana Ledger — Build Spec (decisions locked)

Voice + receipt ledger web app for kirana and small shops, in six Indian languages.
Every decision below is final. **If something is not specified here, stop and ask the
human. Do not invent behaviour.** Tunable constants are marked `TUNE`.

## 1. Stack
| Layer | Choice |
|---|---|
| Frontend | React + Vite (TypeScript), mobile-first web page, no native app, no PWA/offline |
| Backend | Python FastAPI |
| DB / Auth / Files | Supabase (Postgres, email+password auth, private Storage buckets) |
| Deploy | Frontend on Vercel, backend on Render |
| Perception (Sarvam) | Document AI Extract (receipts), STT `mode="translate"`, Translate, TTS (Bulbul) |
| Reasoning (Groq) | `openai/gpt-oss-20b` for strict-JSON parsing and insight narration; `openai/gpt-oss-120b` for tool-calling Q&A |

Existing files: `schema.sql` (already run in Supabase), `llm_router.py` (Groq layer + save rules),
`DESIGN.md` (**the visual spec: follow it exactly for every screen**), `PROMPTS.md` (build steps).

Libraries (locked):
- Frontend: react-router, @tanstack/react-query, @supabase/supabase-js, tailwindcss v4
  (@tailwindcss/vite), framer-motion.
- Backend: fastapi, uvicorn, supabase (supabase-py), groq, sarvamai, httpx, PyJWT[crypto]
  (JWKS verification), python-multipart, pytest.

Repo layout: `/frontend` (Vite app), `/backend` (FastAPI; `app/main.py`, `app/routers/`,
`app/services/sarvam.py`, `app/services/llm_router.py`, `app/db.py`, `tests/`).

**Before writing any Sarvam or Groq call, read current docs.** Sarvam: connect the MCP server
`https://docs.sarvam.ai/_mcp/server`. Groq: console.groq.com/docs. Do not guess SDK signatures.

## 2. Languages
Supported: `ta-IN, hi-IN, en-IN, te-IN, kn-IN, ml-IN`.
- Language is **per user** (`shop_members.lang`), chosen at signup/join, changeable in Settings.
- The shop's `default_lang` only pre-selects the choice for new members.
- STT uses the user's language as input and always returns English text (`mode="translate"`).
- TTS always speaks in the user's language. Answers are translated back from English
  and must pass the number guard (`localize_for_speech`) or fall back to English.
- In the translate call, request international (0-9) digits if the API offers a numerals option.
- **UI text (buttons, labels) is English for this build**; only speech and spoken answers are
  localized. All UI strings live in `frontend/src/strings/en.ts` so languages can be added later.
  User-generated text (party names, notes) is shown as entered, in any script.

## 3. Users & auth
- Supabase email + password. Email confirmation: OFF for the demo.
- Roles: owner and staff have **identical permissions**.
- One user belongs to exactly one shop.
- **Onboarding:** after signup, step 1 is CREATE A SHOP or JOIN WITH CODE (name/code only,
  no API call yet). Step 2 is the language picker; `en-IN` is pre-selected for someone joining.
  On confirming step 2, call `POST /shops` (creator; the chosen language becomes the shop's
  `default_lang`) or `POST /shops/join` (`{code, lang}`).
- Both owner and staff see the invite code in Settings (permissions are identical).
- **Display name:** stored in the user's own Supabase auth metadata at signup (no profile
  table). Audit history shows "You" for the acting user and "Another member" otherwise —
  the backend cannot read another user's auth metadata as a normal user.
- **Backend auth:** the frontend sends the Supabase access token. FastAPI verifies it and
  talks to Supabase **as that user** (user-scoped client), so RLS applies and the audit trigger
  records `auth.uid()`. Use the secret key only for `POST /shops`, `POST /shops/join`, and Storage (section 10).
  The secret key never reaches the frontend.

## 4. Ledger model
Entry types: `credit_given, payment_received, cash_sale, purchase_credit, purchase_paid,
payment_made, expense`. Money is integer paise. Balances come only from the `party_balances` view.

**Correction:** confirmed entries can be edited freely (amount, type, party, date, note).
Every insert and update is logged by the DB trigger. Entries are never deleted; "delete" in
the UI means set `status='voided'`.

## 5. Save rules (implemented in `decide_save`; deterministic, no LLM)
1. Parser set `needs_clarification`, or no amount, or no party for a party type → **clarify**:
   save nothing, speak the question, the user records again.
2. Party matching via SQL `find_party` (filtered by kind: customer for credit_given/payment_received,
   supplier for purchase_*/payment_made):
   - top score ≥ 0.6 and ≥ 0.15 ahead of runner-up → use that party (`TUNE`)
   - any match 0.3–0.6, or two close matches → **confirm** card: "Did you mean X?"
   - no match ≥ 0.3 → create the party with `needs_review=true`, continue
3. Amount > ₹5,000 → **confirm** (pending, needs a tap).
4. Otherwise → **auto**: `status='confirmed'`, `auto_saved=true`, and show an Undo toast for
   **5 seconds**. Undo sets `status='voided'`.

The LLM's opinion is never used to auto-save. New parties get `name_latin` from the English
transcript, lowercased and trimmed.

## 6. Flows

### 6.1 Voice entry ("Add" button, hold to talk)
1. Hold to record, release to send. Hard cap **30 s** with a visible countdown; auto-send at 30 s.
   Minimum 0.7 s (shorter → "Hold the button while speaking").
2. Upload audio to the `voice` bucket, create a `voice_notes` row (`purpose='entry'`).
3. Sarvam STT (translate mode, user's lang) → `transcript_en`.
4. `parse_entry` (Groq, strict JSON) → `find_party` → `decide_save`.
5. The UI shows the result card with amount, party, and type. TTS reads it back in the user's
   language, e.g. "Ramesh, 250 rupees udhaar, saved."
MediaRecorder output (WebM/Opus on Chrome, MP4 on Safari) is sent as-is.

### 6.2 Voice question ("Ask" button, hold to talk)
`voice_question_pipeline`: STT (translate) → Groq Q&A with **read-only** tools → translate back +
number guard → TTS. Show the answer as text and play the audio. `shop_id` is always injected server-side.

### 6.3 Receipt scan ("Scan" button)
1. The user taps the bill kind: **Supplier / Customer / Expense**.
2. Supplier → tap **Paid / Credit**. Customer → tap **Cash / Udhaar**. Expense → no question.
3. Take or upload a photo (JPG/PNG), stored in the `receipts` bucket.
4. Sarvam Document AI **Extract** with schema `{vendor_name: string, bill_date: string, total: number}`,
   language = user's lang. Poll every 2 s, time out after 90 s.
5. **English retry** only if the job fails, or `total` or `bill_date` comes back empty. Then set
   `retried_in_english=true`. If the retry also fails → `status='failed'`, send to the review queue,
   and let the user type the values manually.
6. Show vendor, date, and total as **editable fields** before saving.
7. Map to an entry: supplier+paid → `purchase_paid`; supplier+credit → `purchase_credit`
   (party = vendor, kind supplier); customer+cash → `cash_sale`; customer+udhaar → `credit_given`
   (**ask for the customer name**; the vendor on a customer bill is the shop itself); expense → `expense`.
8. Apply the same save rules (section 5).

Only total, vendor, and date are stored as fields; the full raw OCR JSON is kept in `raw_extract`.

### 6.4 Insights
- A **weekly summary card** for the current week (Mon–Sun) on the home screen. Computed on first view
  each week and cached in `weekly_insights`. Metrics come from SQL; Groq only phrases them
  (`narrate_insights`). Includes: cash sales vs last week, credit given, collected, expenses,
  top 3 debtors with days since last activity.
- Metrics are computed from confirmed entries and include the current partial week; the card
  shows "so far".
- Available as text plus a play button (TTS in the user's language).
- On demand: any "Ask" question.

## 6.5 API contract (FastAPI; all routes except /health need `Authorization: Bearer <supabase token>`)
| Method & path | Body / query | Returns |
|---|---|---|
| GET /health | — | `{ok: true}` |
| GET /me | — | user, membership (lang, tts_voice, role), shop (or `null` → onboarding) |
| PATCH /me | `{lang?, tts_voice?}` | membership |
| POST /shops | `{name, lang}` | shop + membership (caller = owner) |
| POST /shops/join | `{code, lang}` | shop + membership (staff); 404 on bad code |
| GET /parties | `?kind=&q=` | parties with balance_paise, needs_review |
| GET /parties/{id} | — | party, balance, confirmed + pending entries |
| PATCH /parties/{id} | `{display_name?, kind?, needs_review?}` | party (renaming updates name_latin) |
| POST /parties/{id}/merge | `{into_party_id}` | moves all entries to target, adds this name as alias, deletes the now-empty party |
| GET /entries | `?limit=20&status=` | entries, newest first |
| POST /entries | `{type, amount_rupees, party_id?, party_name?, note?, occurred_on?}` | entry (manual source, status confirmed) |
| GET /entries/{id} | — | entry + audit history |
| PATCH /entries/{id} | any editable field | entry |
| POST /entries/{id}/confirm | — | entry |
| POST /entries/{id}/void | — | entry (also used by Undo) |
| POST /voice/entry | multipart `audio` | `{decision: auto/confirm/clarify, entry?, suggestion?, speech_text, audio_b64, voice_note_id}` |
| POST /voice/entry/resolve | `{voice_note_id, choice: use_suggested/create_new}` | same shape as above, re-run from the save decision |
| POST /voice/ask | multipart `audio` | `{text, audio_b64}` |
| POST /receipts | multipart `image`, `kind`, `settled?` | `{receipt_id}`; OCR runs as a BackgroundTask |
| GET /receipts/{id} | — | status, vendor_name, bill_date, total_paise, error |
| POST /receipts/{id}/save | `{vendor_name, bill_date, total_rupees, customer_name?}` | entry + decision (save rules apply) |
| GET /insights/weekly | — | metrics, narration (in caller's language, number-guarded) |
| POST /tts | `{text}` (≤ 2500 chars) | `{audio_b64}` in caller's language/voice |
| GET /review | — | rows of `review_queue` |
| GET /media/{voice or receipts}/{id} | — | `{url}` signed, 10 min |

Amounts cross the API as rupees (number) in requests and paise (integer) in responses; the
frontend formats paise as `₹1,250` (en-IN grouping). Errors: `{error: {code, message}}` with a
plain-English message the UI can show directly.

## 7. Screens
Defined in `DESIGN.md` §6 (app) and §7 (public landing page at `/`). Routes:
`/` landing · `/login` · `/signup` · `/onboarding` · `/app` ledger · `/app/parties` ·
`/app/parties/:id` · `/app/review` · `/app/entries/:id` · `/app/scan` · `/app/settings`.
Every `/app/*` route requires a session and a shop membership; otherwise redirect to `/login` or `/onboarding`.

## 8. Error handling
- Offline (`navigator.onLine` false or fetch fails): the full-screen overlay from DESIGN.md
  §6.13 ("No internet. / Entries can't be saved right now.") with a RETRY button. No queuing.
- Sarvam/Groq 429 or 503: retry with exponential backoff, max 3 tries (1 s, 2 s, 4 s), then show
  "Service busy, try again" and **save nothing** (audio and receipt image stay stored).
- Microphone permission denied: show an instruction screen.

## 9. Storage & privacy
- Buckets `voice` and `receipts`: **private**. Path `{shop_id}/{uuid}.{ext}`. Serve with signed
  URLs that expire after 10 minutes.
- Retention: **forever** (dispute evidence). No deletion job.
- Out of scope for this build: customer payment reminders, WhatsApp, offline mode, line items,
  inventory, GST.

## 9b. Timezone, model pins, defaults
- All dates/times (`occurred_on`, "today" passed to the LLM, the Mon–Sun week boundary) are
  computed in **Asia/Kolkata**, not UTC or server local time.
- STT model: **`saaras:v3`** (Sarvam's recommended default), mode `translate`.
- Default TTS voice per language, used until a user picks one in Settings: `ta: ratan, hi: shubh, en: ratan, te: shubh, kn: shubh, ml: shubh`. The `varun` voice is hidden from the picker.
- Settings voice sample plays the sentence **"Ramesh owes you 250 rupees."** translated into that language — the actual shape of a real read-back, not a greeting.
- Voice read-back and clarification questions are always composed in English server-side, then run through `localize_for_speech` (translate + number guard) before TTS.
- Answering a clarify question: join `first_transcript_en + " " + answer_en` into one string and re-run `parse_entry` on the joined text, rather than parsing the answer alone.
- Receipts: for `purchase_paid`, the vendor is still linked as a supplier party (not just text). For `expense` receipts, the vendor name goes into `entries.note`, not into `parties`.
- `parties.display_name` for a voice-created party is the raw English STT output for the name, as spoken-to-text renders it; `name_latin` is that value lowercased and trimmed.
- `narrate_insights` receives amounts in **rupees**, not paise — convert before building the metrics payload, or the model will speak paise amounts as if they were rupees.
- The number guard in `localize_for_speech` matches on raw digit runs, so a translation that reformats a date (e.g. "26 September" vs "2026-09-26") will fail the guard and fall back to English. Accepted as-is: falling back to English is the safe failure direction.
- Backend Python: pin **3.12** (not whatever the dev machine has) in `runtime.txt` for Render.
- Tests that need real accounts (e.g. shop create → `/me`): create throwaway users via the Supabase admin API and delete them, and their shop, in teardown. Never leave test users in the live project.

## 10. Environment
Backend (Render): `SARVAM_API_KEY, GROQ_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
SUPABASE_SECRET_KEY, ALLOWED_ORIGINS` (comma-separated: Vercel URL + http://localhost:5173).
Frontend (Vercel): `VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_URL`.
- Verify user tokens against the project JWKS at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`
  (asymmetric signing keys; cache the JWKS). No JWT secret is used.
- Storage uploads and signed URLs go through the backend with the secret key, after checking
  that the caller is a member of the shop in the path. No storage RLS policies are needed.
- If the `sb_secret_` key is rejected with "Invalid API key", fall back to the legacy
  `service_role` key from the Legacy API Keys tab and tell the human.
Never commit keys. Provide `.env.example` files.

## 11. Build order
Follow `PROMPTS.md` in order. One prompt = one step = one commit. Don't start the next step
until the human says so.

## 12. Acceptance tests
- "Ramesh ko 250 udhaar diya" (hi) with Ramesh existing → auto-saved, Undo visible 5 s, balance +250.
- Same with ₹6,000 → pending card, no balance change until tapped.
- "Rakesh" when only Ramesh exists → "Did you mean Ramesh?" card; no new party created.
- A brand-new name → party created and flagged in the review queue; entry auto-saved.
- "How much does Ramesh owe?" in Tamil → spoken Tamil answer whose number equals `party_balances`.
- Supplier bill scan, Credit → `purchase_credit` against that supplier; editing the total
  before save works.
- User A in shop 1 cannot read any row of shop 2 (test with two accounts).
- Editing an entry creates an `audit_log` row with before/after and the editor's user id.

## 12b. Migrations
`migrations/001_lock_shop_members.sql` fixes a live RLS hole: the `member_self` policy let a user update any column of their own `shop_members` row, including `shop_id`, `user_id` and `role` — letting them move into another shop or self-promote to owner. Run it once against the Supabase project (SQL editor) before Prompt 4 hardening, if not already applied.

## 13. Known risks (tell the human, don't hide)
- The Render free tier sleeps when idle, so the first request after a pause is slow. Open the app
  a minute before a demo, or use a paid instance.
- Supabase free-tier storage is limited, and keeping audio forever will eventually need a plan upgrade.
- Handwritten and faded thermal bills: OCR accuracy is unknown until tested on real samples.
- The fuzzy-match thresholds (0.6 / 0.15 / 0.3) are starting guesses; tune them on real names.
