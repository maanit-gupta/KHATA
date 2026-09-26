# DEPLOY.md

An ordered checklist for putting this branch live. Nothing here has been run by the automated
build; each step is for a person with access to Supabase, Render and Vercel.

## 0. Before you start
- [ ] Confirm which Supabase project production uses (NEEDS_HUMAN N-003). `SUPABASE_URL` on
      Render and `VITE_SUPABASE_URL` on Vercel must be the same project.
- [ ] Merge `goal/complete-khata` into `main` after review. Render and Vercel deploy from `main`.

## 1. Database (Supabase SQL editor)
Run in order. Each file is safe to run twice.

| File | What it does | Additive? | Applied to the `backend/.env` project? |
|---|---|---|---|
| `schema.sql` | Tables, views, RLS, audit trigger, `find_party` | — (base) | yes (before this run) |
| `migrations/001_lock_shop_members.sql` | Blocks members changing their own `shop_id` / `user_id` / `role` | yes (trigger) | yes (tests prove the behaviour) |
| `migrations/002_one_live_entry_per_receipt.sql` | One live entry per bill (partial unique index) | yes (index) | **no**, apply it (N-004) |

- [ ] Run `migrations/002_one_live_entry_per_receipt.sql`.
- [ ] Run `scripts/verify_db.sql` and check every row says `true` (N-002).
- [ ] Auth → Providers → Email: enabled, **Confirm email off** (CLAUDE.md §3).
- [ ] Storage: buckets `voice` and `receipts` exist and are **private**.

## 2. Backend (Render)
`render.yaml` is a blueprint for one free web service (`rootDir: backend`, Python 3.12.14).

- [ ] Environment variables (dashboard, never committed):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` (if rejected as "Invalid API key", use the legacy `service_role` key) |
| `SARVAM_API_KEY` | Sarvam dashboard |
| `GROQ_API_KEY` | console.groq.com |
| `ALLOWED_ORIGINS` | `https://khata-alpha.vercel.app,http://localhost:5173` (comma-separated, no spaces needed) |

- [ ] Deploy, then `curl https://<service>.onrender.com/health` → `{"ok":true}`.
- [ ] CORS check: `curl -si -X OPTIONS https://<service>.onrender.com/me -H 'Origin: https://khata-alpha.vercel.app' -H 'Access-Control-Request-Method: GET'` must return `access-control-allow-origin: https://khata-alpha.vercel.app`.

### Cold starts (free tier)
The free instance sleeps after about 15 minutes idle; the first request then takes 30–60 s.
The app shows **"Waking the server…"** if the first request takes more than 3 s, so users aren't
left looking at a blank screen.
- For a demo, open `https://<service>.onrender.com/health` a minute beforehand.
- To keep it warm during a demo day, ping `/health` every 10 minutes from any uptime monitor
  (e.g. UptimeRobot, a cron job). `/health` needs no auth and touches no database.
- A background OCR job is lost if the instance sleeps or restarts mid-job; the bill is then
  reported as "Reading the bill stopped. Type the values below." after 5 minutes (D-015).
- The rate limits (voice 12/min, receipts 5/min, TTS 10/min per user) are in memory, per
  instance (D-037).

## 3. Frontend (Vercel)
- [ ] Project root: `frontend/`. `frontend/vercel.json` rewrites every path to the SPA.
- [ ] Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable
      only, never the secret), `VITE_API_URL` (the Render URL, no trailing slash).
- [ ] Optional: `frontend/public/founder.jpg` + bio lines turn on the landing page's "Built by"
      section (N-006).
- [ ] Deploy, then check `/`, `/login`, `/demo` and `/app` (after logging in).

## 4. After deploying
- [ ] Sign up a fresh account, create a shop, say one entry, scan one bill, ask one question.
- [ ] Rotate or delete the shared demo login (N-001).
- [ ] Watch Supabase storage use: audio and bill photos are kept forever (CLAUDE.md §9, §13).
