-- Read-only checks for the live database (GOAL.md Phase 0 step 2). Paste into the Supabase
-- SQL editor. Every row should say ok = true.
select 'rls on ' || c.relname as check, c.relrowsecurity as ok
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'security_invoker on ' || c.relname,
       coalesce('security_invoker=true' = any(c.reloptions), false)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
union all
select 'trigger shop_members_no_tamper (migration 001)',
       exists (select 1 from pg_trigger where tgname = 'shop_members_no_tamper'
               and tgrelid = 'public.shop_members'::regclass)
union all
select 'trigger entries_audit + entries_audit_upd',
       (select count(*) = 2 from pg_trigger where tgrelid = 'public.entries'::regclass
        and tgname in ('entries_audit', 'entries_audit_upd'))
union all
select 'bucket ' || id || ' is private', not public from storage.buckets where id in ('voice', 'receipts');
