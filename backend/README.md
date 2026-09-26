# Kirana Ledger — backend

FastAPI on Python 3.12 (`runtime.txt`). Spec: `../CLAUDE.md`. API notes: `../docs/`.

## Setup
```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then fill in the keys
```
The database schema is `../schema.sql` followed by `../migrations/*.sql` in order, run once in the
Supabase SQL editor. In Supabase Auth, the Email provider must be **enabled** with
**Confirm email turned off** (CLAUDE.md §3).

## Run
```bash
.venv/bin/uvicorn app.main:app --reload --port 8000
curl localhost:8000/health    # {"ok":true}
```
Render start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

## Test
```bash
.venv/bin/pytest -q          # ~300 tests, 10–15 min (live Supabase)
```
- Sarvam and Groq are **always fakes** in tests (`tests/conftest.py` swaps them before every test),
  shaped like the real responses saved in `tests/fixtures/live/`. No test spends credits.
- Database tests run against the live Supabase project in `.env` with throwaway users created
  through the admin API; teardown deletes their shops, audit rows and Storage files, even on failure.
- Live checks that DO spend credits are scripts, run by hand: `scripts/debug_receipt.py` (one bill
  through the OCR path, raw responses saved) and `scripts/live_receipt_e2e.py` (one bill through the API).

## Layout
- `app/main.py`: app, CORS (`ALLOWED_ORIGINS`), `/health`, error middleware
- `app/errors.py`: every error is `{"error": {"code", "message"}}`; Postgres errors mapped to plain English
- `app/auth.py`: Supabase token check against the project JWKS (cached)
- `app/db.py`: `user_client(token)` (RLS applies) and `admin_client()` (secret key; shops/join/Storage only)
- `app/ledger.py`: IST clock, exact rupees→paise, id/date/party checks
- `app/storage.py`: uploads (10 MB, MIME allow-list) and 10-minute signed URLs
- `app/speech.py`: English → translate + number guard → TTS
- `app/qa_tools.py`: the 5 read-only Q&A tools (SQL through the user client)
- `app/ratelimit.py`: per-user token buckets for voice, receipts and TTS
- `app/routers/`: `me`, `shops`, `entries`, `parties`, `voice` (entry, resolve, ask), `receipts`,
  `review`, `media`, `tts`, `insights`
- `app/services/llm_router.py`: the Groq layer (`decide_save` is plain code); `sarvam.py`: the
  Sarvam adapter; `retry.py`: 429/503 backoff 1/2/4 s; `receipt_ocr.py`: the bill-reading job
