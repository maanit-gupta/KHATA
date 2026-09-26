# NEEDS_HUMAN.md

Each open item says what the owner must do, and why Claude couldn't do it. Items closed in run 2
are listed at the end with their evidence.

## Open

- **N-010 Resume the Render backend.** `https://khata-api.onrender.com` answers every request
  with HTTP 503 "Service Suspended" (Render's page, checked 2026-09-26). While it is suspended the
  deployed site can't log anyone in past the loading screen, record, or scan; only the in-browser
  demo worked, and that demo is what returned canned voice and bill results (D-047, D-049).
  **Do:** Render dashboard → the `khata-api` service → resume it (or check billing / free-tier
  limits), then confirm its `SUPABASE_URL` env var is `https://yspgbhgjdwbmxpnkgoeu.supabase.co`.
  *Why not Claude:* changing Render is a deploy action, which GOAL_2.0 §1 forbids.
- **N-008 Delete 4 orphaned recordings.** Verified by SQL on 2026-09-26: shop
  `7e399260-f258-417b-aa09-1da10eb5e153` does not exist, and no `voice_notes` or `receipts` row
  refers to its files. They are hackathon test leftovers (MP3s uploaded 12:51 IST, D-048).
  **Do:** Supabase → Storage → `voice` → folder `7e399260-f258-417b-aa09-1da10eb5e153` → delete
  `21dc20f4-3ad6-4b2d-b457-016f9f4ca4eb.mp3`, `f1ea5adf-d676-4493-ac67-3ab7fa9673d4.mp3`,
  `b3cd29a8-3aad-47f7-b179-8ce0c3ca814e.mp3`, `d4ef9c65-9e9d-4e82-8487-c648d79dd19c.mp3`.
  *Why not Claude:* GOAL_2.0 authorised it, but this session's permission classifier refused the
  Storage delete, and a refused action is not worked around.
- **N-011 Add real test material** (replaces N-005). `test-material/` does not exist, so the
  P1.4 harness ran on synthetic clips and bills (labelled "synthetic" in its report). **Do:** put
  real recordings and bill photos in this layout, then run
  `backend/.venv/bin/python backend/scripts/harness.py`:
  ```
  test-material/voice/*.webm|mp3|m4a|wav
  test-material/voice/expected.csv   # file,lang,what_was_said,expected_type,expected_party,expected_amount
  test-material/bills/*.jpg|png
  test-material/bills/expected.csv   # file,kind,vendor,date,total
  ```
  Include a thermal till slip, a handwritten kachcha bill and a faded one. Each voice file costs
  about 3 Sarvam + 1 Groq calls; each bill 2–11 Sarvam calls. *Why not Claude:* only the owner has
  real shop recordings and real paper bills.
- **N-009 Pick how Hindi and Tamil read-backs are translated.** `artifacts/tts-compare/` has 6
  MP3s: the same three read-backs in Hindi and Tamil, translated three ways (Mayura colloquial,
  which the app uses now; Mayura formal; sarvam-translate). `report.md` there shows every text and
  a machine check (all amounts are pronounced correctly; formal Tamil dropped a digit group once,
  which the number guard catches). **Do:** have a native Hindi and a native Tamil speaker listen and
  pick one per language, then set it in `backend/app/constants.py` → `TRANSLATE`. *Why not
  Claude:* whether a sentence sounds natural, and whether "எடுத்துக்கிட்டாரு" or "கடன்" reads as
  the right direction of udhaar, needs a native ear.
- **N-007 Review and merge the branches.** Neither run merges or deploys. Review
  `goal/khata-2` (built on `goal/complete-khata`), merge to `main`, apply the migrations listed
  in DEPLOY.md, then deploy.
- **N-006 Landing page content.** (1) Put the maker's photo at `frontend/public/founder.jpg` and
  4 bio lines in `frontend/src/strings/en.ts` → `landing.builtByBio`; the "Built by" section then
  appears. (2) Have a native speaker check the six "Say it your way" lines
  (`landing.sayLines`, marked `TODO: native-speaker check`). *Why not Claude:* the photo and bio
  are personal facts, and the lines need a native ear.

## Closed in run 2

- **N-001 (shared demo login)** — closed. `demo-walk@example.com` does not exist in the only
  Supabase project the owner's account holds (`yspgbhgjdwbmxpnkgoeu`, 0 users), and the deployed
  frontend authenticates only against that project (D-046). There is nothing left to rotate.
- **N-002 (catalog checks)** — closed. `scripts/verify_db.sql` run through the MCP connector;
  all 16 rows `ok` (PROGRESS.md, P0.2).
- **N-003 (which project production uses)** — database half closed: `backend/.env`, the MCP
  connector and the deployed Vercel bundle all use `yspgbhgjdwbmxpnkgoeu` (D-046). The Render half
  is N-010.
- **N-004 (migration 002)** — closed. Applied through the connector; index
  `entries_one_live_per_receipt` present (D-048).
