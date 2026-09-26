# Kirana Ledger — backend

FastAPI on Python 3.12 (`runtime.txt`). Spec: `../CLAUDE.md`. API notes: `../docs/`.

## Setup
```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then fill in the keys
```
The database schema is `../schema.sql` followed by `../migrations/*.sql`, run once in the
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
.venv/bin/pytest -q
```
Token-rejection tests run offline. Every other test runs against the live Supabase project in
`.env`: it creates throwaway users (confirmed, via the admin API) and deletes them and their
shops in teardown, even when a test fails.

## Layout
- `app/main.py`: app, CORS (`ALLOWED_ORIGINS`), `/health`
- `app/errors.py`: every error is `{"error": {"code", "message"}}`
- `app/auth.py`: Supabase token check against the project JWKS (cached)
- `app/db.py`: `user_client(token)` (RLS applies) and `admin_client()` (secret key; shops/join/Storage only)
- `app/routers/`: `me.py` (`GET/PATCH /me`), `shops.py` (`POST /shops`, `POST /shops/join`)
- `app/services/llm_router.py`: the reviewed Groq layer, moved here unchanged
