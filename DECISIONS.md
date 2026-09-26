# DECISIONS.md

Format: `D-### | date | question | options considered | choice | why`

D-001 | 2026-09-26 | CLAUDE.md §1/§11 says "follow PROMPTS.md"; the file is not in the repo. What drives the build order? | (a) stop and ask (b) follow GOAL.md §5 | (b) GOAL.md §5 | GOAL.md is the top source of truth and says not to wait for input.
D-002 | 2026-09-26 | The Supabase MCP connector cannot see the KHATA project, so live catalog checks (trigger names, `reloptions`) and `apply_migration` are unavailable. How to verify the DB and apply migrations? | (a) guess (b) behavioural checks through PostgREST with throwaway users; hand SQL checks and any migration to a human | (b) | Behavioural checks prove what matters (RLS on, views don't leak, tamper blocked). Anything needing DDL is written to `migrations/` and listed in NEEDS_HUMAN.md.
D-003 | 2026-09-26 | Test cleanup cannot delete a shop that has entries because `audit_log.entry_id` has no `ON DELETE CASCADE`. | (a) migration adding cascade (not additive: changes an FK) (b) test teardown deletes the throwaway shop's `audit_log` rows first, then the shop | (b) | GOAL §1.2 allows deleting throwaway test data the test created; altering the FK is not additive.
