# Khata: a voice and receipt ledger for kirana shops

Khata is a mobile-first web ledger for kirana and other small shops in India. The shopkeeper
holds a button and says an entry in their own language, for example *"Ramesh ko 250 udhaar
diya"*. Khata writes it down, matches the customer, and reads it back aloud. Supplier and
customer bills can be photographed instead of typed.

- **Live app:** https://khata-alpha.vercel.app
- **Languages:** Tamil, Hindi, English, Telugu, Kannada, Malayalam (speech and read-back; the UI text is English)

## How it works

```
 voice ─► Sarvam STT (translate → English) ─► Groq parse_entry (strict JSON)
                                                     │
 photo ─► Sarvam Document AI extract ─► editable form│
                                                     ▼
                         find_party (Postgres trigram match) ─► decide_save (deterministic)
                                                     │
                     auto-save + 5 s Undo  /  confirm card  /  ask again
                                                     │
                            translate back + number guard ─► Sarvam TTS read-back
```

The model does not decide what gets saved. `decide_save` is plain code that applies these rules:

| Situation | Result |
|---|---|
| No amount, no name, or the parser asked a question | Save nothing and speak the question |
| Name matches a party (score ≥ 0.6, clear winner) | Use that party |
| Close but uncertain match (0.3–0.6) | "Did you mean X?" confirm card |
| No match | Create the party, flagged for review |
| Amount above ₹5,000 | Save as pending until tapped |
| Otherwise | Auto-save with a 5-second Undo |

Money is stored as integer paise. Balances come only from the `party_balances` SQL view.
Entries are never deleted, only voided, and a database trigger audits every insert and update.
Row-level security keeps each shop's data private to its members.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind v4, TanStack Query, framer-motion (on **Vercel**) |
| Backend | Python 3.12 FastAPI (on **Render**) |
| Data / auth / files | Supabase: Postgres + RLS, email/password auth, private Storage buckets |
| Speech, translation, OCR | Sarvam AI: `saaras:v3` STT, `mayura:v1` translate, `bulbul:v3` TTS, Document AI |
| Reasoning | Groq: `openai/gpt-oss-20b` (parsing), `openai/gpt-oss-120b` (Q&A) |

## Status

What is built so far:

- [x] Sign up / log in, create a shop or join one with an invite code, per-user language
- [x] Voice entry (hold to talk, 30 s cap), save rules, spoken read-back, 5 s Undo
- [x] Ledger, manual add, confirm / void, parties list with balances, party detail
- [x] Receipt scan screen: bill kind, Paid/Credit, photo, editable vendor/date/total, save
- [ ] Receipt auto-fill: the Sarvam extract job completes but has returned an empty result
      in testing. Values are typed by hand for now.
- [ ] Voice questions ("How much does Ramesh owe?"), weekly insights card, review queue,
      entry edit history, settings (language/voice), public landing page

## Repo layout

```
frontend/          Vite app (screens in src/screens, UI strings in src/strings/en.ts)
backend/           FastAPI app (app/routers, app/services/{sarvam,llm_router}.py, tests/)
schema.sql         Database schema (run once in Supabase)
migrations/        SQL to run after schema.sql
scripts/           seed_demo.py fills a shop with demo parties and entries
docs/              Verified Sarvam and Groq API notes
CLAUDE.md          Product and build spec
DESIGN.md          Visual spec
render.yaml        Render blueprint for the backend
```

## Run locally

**1. Database.** In a Supabase project, run `schema.sql`, then `migrations/*.sql`, in the SQL
editor. Under Auth, enable the Email provider and turn **Confirm email** off. Create two
private Storage buckets, `voice` and `receipts`.

**2. Backend.**
```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in the Supabase, Sarvam and Groq keys
.venv/bin/uvicorn app.main:app --reload --port 8000
curl localhost:8000/health      # {"ok":true}
```

**3. Frontend.**
```bash
cd frontend
npm install
cp .env.example .env.local      # Supabase URL + publishable key, VITE_API_URL=http://localhost:8000
npm run dev                     # http://localhost:5173
```

**4. Demo data (optional).**
```bash
backend/.venv/bin/python scripts/seed_demo.py you@example.com
```

**Tests:** `cd backend && .venv/bin/pytest -q`. Most tests use the live Supabase project in
`.env`. They create throwaway users through the admin API and delete them afterwards.

## Deploy

**Backend on Render.** In Render, create a new **Blueprint** from this repo; it reads
`render.yaml`. Set these secrets in the dashboard: `SARVAM_API_KEY`, `GROQ_API_KEY`,
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `ALLOWED_ORIGINS`
(for example `https://khata-alpha.vercel.app,http://localhost:5173`).

**Frontend on Vercel.** Set the project root to `frontend/` and add these env vars:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL` (the Render URL).
`frontend/vercel.json` rewrites every path to the SPA.

The secret key stays on the backend. The frontend only gets the publishable key.

## Known limits

- Render's free tier sleeps when idle, so the first request after a pause is slow. Open the app
  a minute before a demo.
- Audio and bill photos are kept forever as evidence, so Supabase free-tier storage will
  eventually fill up.
- OCR accuracy on handwritten or faded thermal bills is untested.
- The name-match thresholds (0.6 / 0.15 / 0.3) are starting guesses, not yet tuned on real names.
- Out of scope: payment reminders, WhatsApp, offline mode, line items, inventory, GST.
