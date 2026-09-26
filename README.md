<div align="center">

# 📒 Khata

**Your shop's khata, by voice.**
A voice and receipt ledger for kirana shops, in six Indian languages.

[![Try the live demo](https://img.shields.io/badge/▶_Try_the_live_demo-no_login_needed-111?style=for-the-badge)](https://khata-alpha.vercel.app/demo)
&nbsp;
[![How it works](https://img.shields.io/badge/How_it_works-/about-E8E9ED?style=for-the-badge&labelColor=111)](https://khata-alpha.vercel.app/about)
&nbsp;
[![Open the app](https://img.shields.io/badge/Open_the_app-khata--alpha.vercel.app-B8F3FF?style=for-the-badge&labelColor=111)](https://khata-alpha.vercel.app)

![React](https://img.shields.io/badge/React_+_Vite-TypeScript-3178C6?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.12-009688?logo=fastapi&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres_+_RLS-3FCF8E?logo=supabase&logoColor=white)
![Sarvam AI](https://img.shields.io/badge/Sarvam_AI-speech_·_OCR-FF6B00)
![Groq](https://img.shields.io/badge/Groq-gpt--oss-F55036)
![Vercel](https://img.shields.io/badge/Vercel-frontend-000?logo=vercel)

</div>

---

A shopkeeper holds a button and says *"Ramesh ko 250 udhaar diya"*. Khata writes the entry,
matches the customer, and says it back: *"Ramesh, 250 rupees udhaar, saved."* A supplier bill
can be photographed instead of typed.

## 🚀 Try it in 30 seconds

| | Link | Login |
|---|---|---|
| **Demo mode** (recommended) | **[khata-alpha.vercel.app/demo](https://khata-alpha.vercel.app/demo)** | None. Opens straight into a sample shop |
| **How it works** | [khata-alpha.vercel.app/about](https://khata-alpha.vercel.app/about) | None. A walkthrough of the whole flow |
| **Real account** | [khata-alpha.vercel.app/signup](https://khata-alpha.vercel.app/signup) | Sign up with any email (no confirmation email) |

> [!NOTE]
> **Demo mode** runs entirely in your browser on a sample shop, *Sharma Kirana Store*. Nothing
> is saved, and a reload resets it. Voice and bill reading are **simulated** in the demo; real
> accounts call Sarvam and Groq through the backend. You can also enter from the
> **"Try the demo"** button on the login page. **Exit demo** is in the cyan banner.

### Guided tour of the demo

- [ ] **Ledger.** Recent entries for the sample shop. Tap **Add by hand** → *Credit given*, ₹300, "Ramesh" → **Save entry**, then **Undo** within 5 seconds.
- [ ] **Hold to add.** Hold the black button for a second and release. Each press adds the next canned voice note:
  - 1st: *Ramesh, ₹250 udhaar*: **auto-saved** with an Undo toast
  - 2nd: *Lakshmi, ₹500 payment received*: auto-saved
  - 3rd: *Suresh, ₹6,000 udhaar*: over ₹5,000, so it waits as **pending** until you tap **Confirm**
- [ ] **Scan.** Tap **Supplier** → **Credit** → pick any JPG/PNG. The vendor, date and total fill in; **edit the total**, then **Save**.
- [ ] **Parties.** The new supplier shows up flagged **NEW**, with *You owe ₹…*. Tap a party to see its entries.

<details>
<summary><b>What the real app does differently</b></summary>

| Step | Demo mode | Real account |
|---|---|---|
| Voice | Canned sentences, no microphone upload | Audio → Sarvam `saaras:v3` (translate to English) → Groq `parse_entry` |
| Read-back | Shown as text | Translated to your language, number-checked, spoken by Sarvam `bulbul:v3` |
| Bill scan | Fixed sample values | Photo → Sarvam Document AI extract (2 s polling, 60 s timeout) |
| Data | In memory, gone on reload | Supabase Postgres with row-level security per shop, audit log on every change |

</details>

## 🧠 How it works

```mermaid
flowchart LR
    V["🎙️ Hold to talk"] --> STT["Sarvam STT<br/>translate → English"]
    STT --> P["Groq parse_entry<br/>strict JSON"]
    B["🧾 Bill photo"] --> OCR["Sarvam Document AI<br/>extract"]
    OCR --> F["Editable form"]
    P --> M["find_party<br/>trigram match"]
    F --> M
    M --> D{"decide_save<br/>(plain code)"}
    D -->|clear match, ≤ ₹5,000| A["✅ Auto-save<br/>5 s Undo"]
    D -->|"unsure / > ₹5,000"| C["🟦 Confirm card"]
    D -->|missing amount or name| Q["❓ Ask again"]
    A --> T["Translate + number guard<br/>→ Sarvam TTS"]
    C --> T
    Q --> T
```

**The model never decides what gets saved.** `decide_save` is plain code:

| Situation | What happens |
|---|---|
| No amount, no name, or the parser asked a question | Nothing is saved; the question is spoken |
| Name matches a party (score ≥ 0.6, 0.15 ahead of the next) | That party is used |
| Close but uncertain match (0.3–0.6) | "Did you mean X?" card |
| No match at all | The party is created and flagged for review |
| Amount above ₹5,000 | Saved as **pending** until someone taps Confirm |
| Everything else | **Auto-saved**, with a 5-second Undo |

<details>
<summary><b>Ledger rules</b></summary>

- Money is stored as integer **paise**. Balances come only from the `party_balances` SQL view.
- Entry types: `credit_given`, `payment_received`, `cash_sale`, `purchase_credit`, `purchase_paid`, `payment_made`, `expense`.
- Entries are never deleted, only **voided**. A database trigger writes an audit row with before/after for every insert and update.
- Row-level security: a user can only read and write rows for their own shop.
- Bill mapping: supplier + paid → `purchase_paid`, supplier + credit → `purchase_credit`, customer + cash → `cash_sale`, customer + udhaar → `credit_given` (asks for the customer's name), expense → `expense`.
- Dates use **Asia/Kolkata** time.

</details>

## ✅ Status

| Feature | State |
|---|---|
| Sign up, log in, create or join a shop (invite code), per-user language | ✅ Done |
| Voice entry: hold to talk (30 s cap), save rules, spoken read-back, 5 s Undo | ✅ Done |
| Ledger, add by hand, confirm / void, parties with balances, party detail | ✅ Done |
| Bill scan: kind, Paid/Credit, photo, editable vendor/date/total, save | ✅ Done |
| Demo mode (`/demo`) | ✅ Done |
| Bill auto-fill from Sarvam | ⚠️ The job completes but returned empty fields in testing; values are typed by hand for now |
| Voice questions ("How much does Ramesh owe?"), weekly insights, review queue, settings, landing page | 🚧 Not built yet |

## 🗂️ Repo layout

```
frontend/        React + Vite app — screens in src/screens, demo backend in src/lib/demo.ts
backend/         FastAPI — app/routers, app/services/{sarvam,llm_router}.py, tests/
schema.sql       Database schema (run once in Supabase)
migrations/      SQL to run after schema.sql
scripts/         seed_demo.py: fills a real shop with sample parties and entries
docs/            Checked notes on the Sarvam and Groq APIs
CLAUDE.md        Product and build spec  ·  DESIGN.md  Visual spec
render.yaml      Render blueprint for the backend
```

## 💻 Run locally

<details>
<summary><b>1. Database (Supabase)</b></summary>

1. Run `schema.sql`, then each file in `migrations/`, in the Supabase SQL editor.
2. Under **Auth → Providers**, enable Email and turn **Confirm email** off.
3. Under **Storage**, create two **private** buckets: `voice` and `receipts`.

</details>

<details>
<summary><b>2. Backend (FastAPI)</b></summary>

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in Supabase, Sarvam and Groq keys
.venv/bin/uvicorn app.main:app --reload --port 8000
curl localhost:8000/health      # → {"ok":true}
```

Tests: `.venv/bin/pytest -q`. Most tests use the live Supabase project in `.env`. They create
throwaway users through the admin API and delete them afterwards.

</details>

<details>
<summary><b>3. Frontend (Vite)</b></summary>

```bash
cd frontend
npm install
cp .env.example .env.local      # Supabase URL + publishable key, VITE_API_URL=http://localhost:8000
npm run dev                     # → http://localhost:5173  (demo: http://localhost:5173/demo)
```

</details>

<details>
<summary><b>4. Sample data for a real shop (optional)</b></summary>

```bash
backend/.venv/bin/python scripts/seed_demo.py you@example.com
```
Adds 6 parties and 15 entries to that user's shop.

</details>

## ☁️ Deploy

<details>
<summary><b>Backend → Render</b></summary>

1. In Render: **New → Blueprint** → pick this repo. It reads `render.yaml`.
2. Set these secrets in the dashboard: `SARVAM_API_KEY`, `GROQ_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and
   `ALLOWED_ORIGINS=https://khata-alpha.vercel.app,http://localhost:5173`.
3. Check `https://<your-service>.onrender.com/health`.

</details>

<details>
<summary><b>Frontend → Vercel</b></summary>

1. Set the project root to `frontend/`.
2. Add these env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_API_URL` (the Render URL).
3. `vercel --prod`. `frontend/vercel.json` sends every path to the app, so links like `/demo` and `/app/scan` work.

</details>

> [!IMPORTANT]
> The Supabase **secret** key stays on the backend. The frontend only gets the publishable key.

## ⚠️ Known limits

- Render's free tier sleeps when idle, so the first real request after a pause is slow. Open the app a minute before a demo. Demo mode doesn't need the backend.
- Audio and bill photos are kept forever as evidence, so Supabase free-tier storage will eventually fill up.
- OCR accuracy on handwritten or faded thermal bills is untested.
- The name-match thresholds (0.6 / 0.15 / 0.3) are starting guesses, not yet tuned on real names.
- Out of scope: payment reminders, WhatsApp, offline mode, line items, inventory, GST.
