-- =====================================================================
-- Kirana Ledger — Postgres / Supabase schema (v2, decisions locked)
-- Principles:
--   1. Money is stored as INTEGER PAISE (never floats).
--   2. Balances are DERIVED from entries (view), never stored and mutated.
--   3. Auto-save is decided by deterministic code rules (see CLAUDE.md),
--      never by an LLM's self-reported confidence.
--   4. Every entry keeps its evidence (audio / receipt image), kept forever.
--   5. Entries can be edited freely; every insert/update is written to
--      audit_log by a trigger, so history can't be skipped by app code.
-- =====================================================================

create extension if not exists pg_trgm;   -- fuzzy party-name matching
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------- enums ----------
create type party_kind   as enum ('customer', 'supplier');
create type entry_type   as enum (
  'credit_given',      -- customer took goods on udhaar     (+ they owe shop)
  'payment_received',  -- customer repaid                   (- they owe shop)
  'cash_sale',         -- sale paid immediately (no party balance effect)
  'purchase_credit',   -- stock bought on credit            (+ shop owes supplier)
  'purchase_paid',     -- stock bought and paid immediately (no balance effect)
  'payment_made',      -- shop paid a supplier              (- shop owes supplier)
  'expense'            -- rent, electricity, wages, etc.
);
create type entry_status as enum ('pending', 'confirmed', 'voided');
create type entry_source as enum ('voice', 'receipt', 'manual');
create type bill_kind    as enum ('supplier', 'customer', 'expense');
create type job_status   as enum ('queued', 'processing', 'done', 'failed');

-- Supported working languages (BCP-47, as Sarvam expects)
create domain app_lang as text check (value in
  ('ta-IN', 'hi-IN', 'en-IN', 'te-IN', 'kn-IN', 'ml-IN'));

-- ---------- tenancy ----------
create table shops (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  default_lang  app_lang not null default 'ta-IN',   -- default for new members only
  invite_code   text not null unique
                default upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6)),
  created_at    timestamptz not null default now()
);

create table shop_members (
  shop_id       uuid not null references shops(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'staff' check (role in ('owner', 'staff')),
  lang          app_lang not null,                    -- each user picks their own
  tts_voice     text,                                 -- chosen Bulbul speaker
  joined_at     timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create unique index one_shop_per_user on shop_members (user_id);  -- a user belongs to one shop

-- ---------- parties ----------
create table parties (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  kind          party_kind not null,
  display_name  text not null,
  name_latin    text not null,          -- lowercased Latin form used for matching
  phone         text,
  needs_review  boolean not null default false,   -- auto-created from voice/receipt
  created_at    timestamptz not null default now()
);
create index parties_shop_idx      on parties (shop_id);
create index parties_name_trgm_idx on parties using gin (name_latin gin_trgm_ops);
create unique index parties_unique_name on parties (shop_id, kind, name_latin);

create table party_aliases (
  party_id      uuid not null references parties(id) on delete cascade,
  alias_latin   text not null,
  primary key (party_id, alias_latin)
);
create index party_aliases_trgm_idx on party_aliases using gin (alias_latin gin_trgm_ops);

-- ---------- evidence ----------
create table receipts (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references shops(id) on delete cascade,
  image_path         text not null,             -- private bucket 'receipts'
  kind               bill_kind not null,        -- tapped by user before scanning
  settled            boolean,                   -- paid/cash = true, credit/udhaar = false; null for expense
  ocr_lang_first     app_lang not null,         -- the user's language
  retried_in_english boolean not null default false,
  sarvam_job_id      text,
  status             job_status not null default 'queued',
  vendor_name        text,                      -- extracted, user-editable
  bill_date          date,
  total_paise        bigint,
  raw_extract        jsonb,                     -- untouched Sarvam output, kept forever
  error              text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  constraint settled_required check (kind = 'expense' or settled is not null)
);
create index receipts_shop_status_idx on receipts (shop_id, status);

create table voice_notes (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  audio_path    text not null,                  -- private bucket 'voice'
  spoken_lang   app_lang not null,
  purpose       text not null check (purpose in ('entry', 'question')),
  transcript_en text,                           -- Sarvam STT, mode='translate'
  parsed        jsonb,                          -- Groq structured output
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- ---------- the ledger ----------
create table entries (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  party_id      uuid references parties(id),
  type          entry_type not null,
  amount_paise  bigint not null check (amount_paise > 0),
  note          text,
  occurred_on   date not null default current_date,
  status        entry_status not null default 'pending',
  source        entry_source not null,
  auto_saved    boolean not null default false,
  review_reason text,                           -- why it needs a tap / was flagged
  receipt_id    uuid references receipts(id),
  voice_note_id uuid references voice_notes(id),
  created_by    uuid,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint party_required check (
    (type in ('cash_sale', 'purchase_paid', 'expense')) or party_id is not null),
  constraint confirmed_has_time check (status <> 'confirmed' or confirmed_at is not null)
);
create index entries_shop_date_idx on entries (shop_id, occurred_on desc);
create index entries_party_idx     on entries (party_id) where status = 'confirmed';
create index entries_pending_idx   on entries (shop_id) where status = 'pending';

-- ---------- audit trail (written by trigger only) ----------
create table audit_log (
  id        bigserial primary key,
  shop_id   uuid not null,
  entry_id  uuid not null references entries(id),
  action    text not null check (action in ('create', 'edit', 'confirm', 'void')),
  before    jsonb,
  after     jsonb,
  actor     uuid,
  at        timestamptz not null default now()
);

create or replace function log_entry_change() returns trigger
language plpgsql security definer as $$
declare act text;
begin
  if tg_op = 'INSERT' then
    act := 'create';
  elsif new.status = 'voided' and old.status <> 'voided' then
    act := 'void';
  elsif new.status = 'confirmed' and old.status = 'pending' then
    act := 'confirm';
  else
    act := 'edit';
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  insert into audit_log (shop_id, entry_id, action, before, after, actor)
  values (new.shop_id, new.id, act,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new), auth.uid());
  return new;
end $$;

create trigger entries_audit
  after insert on entries for each row execute function log_entry_change();
create trigger entries_audit_upd
  before update on entries for each row execute function log_entry_change();

-- ---------- weekly insights cache ----------
create table weekly_insights (
  shop_id     uuid not null references shops(id) on delete cascade,
  week_start  date not null,                      -- Monday
  metrics     jsonb not null,                     -- computed by SQL
  narration_en text not null,                     -- phrased by Groq from metrics only
  created_at  timestamptz not null default now(),
  primary key (shop_id, week_start)
);

-- ---------- derived views (respect RLS via security_invoker, PG15+) ----------
create view party_balances with (security_invoker = true) as
select
  p.shop_id, p.id as party_id, p.display_name, p.kind, p.needs_review,
  coalesce(sum(case e.type
      when 'credit_given'     then  e.amount_paise
      when 'payment_received' then -e.amount_paise
      when 'purchase_credit'  then -e.amount_paise
      when 'payment_made'     then  e.amount_paise
      else 0 end), 0) as balance_paise,          -- + party owes shop, - shop owes party
  max(e.occurred_on) as last_activity
from parties p
left join entries e on e.party_id = p.id and e.status = 'confirmed'
group by p.shop_id, p.id, p.display_name, p.kind, p.needs_review;

create view daily_summary with (security_invoker = true) as
select shop_id, occurred_on,
  coalesce(sum(amount_paise) filter (where type = 'cash_sale'), 0)        as cash_sales_paise,
  coalesce(sum(amount_paise) filter (where type = 'credit_given'), 0)     as credit_given_paise,
  coalesce(sum(amount_paise) filter (where type = 'payment_received'), 0) as collected_paise,
  coalesce(sum(amount_paise) filter (where type in ('purchase_credit','purchase_paid')), 0) as purchases_paise,
  coalesce(sum(amount_paise) filter (where type = 'payment_made'), 0)     as supplier_paid_paise,
  coalesce(sum(amount_paise) filter (where type = 'expense'), 0)          as expenses_paise,
  count(*) as entry_count
from entries where status = 'confirmed'
group by shop_id, occurred_on;

-- Review queue: everything a human should look at
create view review_queue with (security_invoker = true) as
select 'entry' as item, e.id, e.shop_id, e.review_reason as reason, e.created_at
  from entries e where e.status = 'pending'
union all
select 'party', p.id, p.shop_id, 'new party created automatically', p.created_at
  from parties p where p.needs_review
union all
select 'receipt', r.id, r.shop_id, coalesce(r.error, 'could not read total or date'), r.created_at
  from receipts r where r.status = 'failed';

-- ---------- fuzzy party lookup ----------
create or replace function find_party(p_shop uuid, p_query text, p_kind party_kind default null,
                                      p_limit int default 3)
returns table (party_id uuid, display_name text, kind party_kind, score real)
language sql stable security invoker as $$
  select p.id, p.display_name, p.kind,
         greatest(similarity(p.name_latin, lower(p_query)),
                  coalesce(max(similarity(a.alias_latin, lower(p_query))), 0)) as score
  from parties p
  left join party_aliases a on a.party_id = p.id
  where p.shop_id = p_shop and (p_kind is null or p.kind = p_kind)
  group by p.id, p.display_name, p.kind, p.name_latin
  having greatest(similarity(p.name_latin, lower(p_query)),
                  coalesce(max(similarity(a.alias_latin, lower(p_query))), 0)) >= 0.3
  order by score desc
  limit p_limit;
$$;

-- ---------- Row Level Security ----------
create or replace function is_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_members where shop_id = p_shop and user_id = auth.uid());
$$;

alter table shops           enable row level security;
alter table shop_members    enable row level security;
alter table parties         enable row level security;
alter table party_aliases   enable row level security;
alter table receipts        enable row level security;
alter table voice_notes     enable row level security;
alter table entries         enable row level security;
alter table audit_log       enable row level security;
alter table weekly_insights enable row level security;

create policy shop_read      on shops           for select using (is_member(id));
create policy members_read   on shop_members    for select using (is_member(shop_id));
create policy member_self    on shop_members    for update using (user_id = auth.uid());
create policy party_all      on parties         using (is_member(shop_id)) with check (is_member(shop_id));
create policy alias_all      on party_aliases   using (
  exists (select 1 from parties p where p.id = party_id and is_member(p.shop_id)));
create policy receipt_all    on receipts        using (is_member(shop_id)) with check (is_member(shop_id));
create policy voice_all      on voice_notes     using (is_member(shop_id)) with check (is_member(shop_id));
create policy entry_all      on entries         using (is_member(shop_id)) with check (is_member(shop_id));
create policy audit_read     on audit_log       for select using (is_member(shop_id));
create policy insights_all   on weekly_insights using (is_member(shop_id)) with check (is_member(shop_id));
-- No DELETE is ever issued on entries by the app (void instead). Shop creation and
-- joining by invite code go through backend endpoints (see CLAUDE.md), not direct inserts.
