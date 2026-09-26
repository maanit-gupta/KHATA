# NEEDS_HUMAN.md

Each item: what's blocked, and the exact action needed.

- **N-001 Rotate the shared demo password.** The test login `demo-walk@example.com` was shared publicly during judging. After judging, change its password (Supabase → Authentication → Users → the user → Reset password), or delete the user. Note: that user does **not** exist in the Supabase project in `backend/.env` (it has 0 users as of 2026-09-26), so check which project the deployed Render backend points at (see N-003).
- **N-002 Run the catalog checks in the Supabase SQL editor.** The Supabase MCP connector used in this run had no access to project `yspgbhgjdwbmxpnkgoeu`, so these were verified by behaviour only. Paste `scripts/verify_db.sql` into the SQL editor and confirm every row says `ok`.
- **N-003 Confirm which Supabase project production uses.** The project in `backend/.env` holds 0 users and 0 shops, yet the README says the deployed app has had real sign-ups. Check `SUPABASE_URL` on Render and `VITE_SUPABASE_URL` on Vercel match `backend/.env`. If they don't, apply `migrations/` to the production project too.
- **N-004 Apply migration 002.** Paste `migrations/002_one_live_entry_per_receipt.sql` into the Supabase SQL editor (additive: one partial unique index). It closes the double-tap race on saving a bill. The app already refuses a second save; the index makes that airtight.
- **N-005 Test bill reading on real paper.** The live checks used a synthetic printed bill and a phone-photo-style version (both filled 3/3 fields). Photograph 3–5 real bills (a thermal till slip, a handwritten kachcha bill, a faded one) through Scan and note which fields fill. Each bill costs about 5–11 Sarvam calls.
