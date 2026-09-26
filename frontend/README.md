# Kirana Ledger — frontend

React + Vite + TypeScript, Tailwind v4, framer-motion. Visual spec: `../DESIGN.md`.

```bash
cd frontend
npm install
cp .env.example .env.local   # Supabase URL + PUBLISHABLE key, API URL
npm run dev                  # http://localhost:5173 (backend on :8000)
npm run build                # type-check + production bundle
npm run lint
npm run typecheck            # src/ and e2e/
npx playwright install chromium   # once
npm run test:e2e             # Playwright against a mocked API (e2e/mock.ts), headless
```

- `/dev/ui`: every component and state (dev server only; not in production builds).
- Design tokens: `src/styles/tokens.css`. Components: `src/components/ui/`. Strings: `src/strings/en.ts`.
- Route guards (`src/auth/guards.tsx`): `/app/*` needs a session and a shop; `/onboarding` needs a
  session and no shop; `/login` and `/signup` redirect signed-in users.
