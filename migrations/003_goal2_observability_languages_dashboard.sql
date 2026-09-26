-- =====================================================================
-- Migration 003 (GOAL_2.0 §4). ADDITIVE ONLY: new nullable columns, new tables with RLS, new
-- security_invoker views, new security_invoker functions, new indexes, a realtime publication
-- membership. No drop, rename, type change or loosened policy. Every statement is safe to run
-- more than once.
-- =====================================================================

-- ---------- P1.3 observability: every stage's raw output ----------
alter table voice_notes add column if not exists stt_raw           text;  -- exact Sarvam transcript, unprocessed
alter table voice_notes add column if not exists decision          text;  -- auto | confirm | clarify
alter table voice_notes add column if not exists speech_text_en    text;  -- read-back / answer composed in English
alter table voice_notes add column if not exists speech_text_local text;  -- what was actually spoken
-- (voice_notes.parsed already holds the parser output.)
alter table receipts add column if not exists ocr_text text;              -- raw Digitise markdown
-- (receipts.raw_extract already holds the raw Extract output; not duplicated.)

-- ---------- P4.1 names, P5 per-aspect languages, P1.6 auto-detect ----------
alter table shop_members add column if not exists display_name text;
alter table shop_members add column if not exists ui_lang      app_lang;   -- null → lang
alter table shop_members add column if not exists voice_lang   app_lang;   -- null → lang
alter table shop_members add column if not exists report_lang  app_lang;   -- null → lang
alter table shop_members add column if not exists speech_auto  boolean;    -- true → STT language_code 'unknown'

-- ---------- P6.6 expense categories ----------
alter table entries add column if not exists expense_category text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'entries_expense_category_check') then
    alter table entries add constraint entries_expense_category_check check (
      expense_category is null or (type = 'expense' and expense_category in
        ('stock_other', 'rent', 'electricity', 'wages', 'transport', 'repairs', 'misc')));
  end if;
end $$;

-- ---------- P7 caches ----------
create table if not exists ai_reports (
  shop_id      uuid not null references shops(id) on delete cascade,
  period_type  text not null check (period_type in ('day', 'week', 'month')),
  period_start date not null,
  lang         app_lang not null,
  facts        jsonb not null,            -- SQL numbers + fired tips given to the model
  facts_hash   text not null,             -- regenerate only when this changes
  text         text not null,             -- phrased summary, in `lang`, number-guarded
  created_at   timestamptz not null default now(),
  primary key (shop_id, period_type, period_start, lang)
);

create table if not exists daily_briefings (
  shop_id     uuid not null references shops(id) on delete cascade,
  day         date not null,
  lang        app_lang not null,
  facts       jsonb not null,
  facts_hash  text not null,
  text_en     text not null,
  text        text not null,               -- in `lang`
  audio       jsonb not null default '{}'::jsonb,   -- {voice: path in the private `voice` bucket}
  created_at  timestamptz not null default now(),
  primary key (shop_id, day, lang)
);

alter table ai_reports      enable row level security;
alter table daily_briefings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ai_reports' and policyname = 'ai_reports_all') then
    create policy ai_reports_all on ai_reports using (is_member(shop_id)) with check (is_member(shop_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'daily_briefings' and policyname = 'daily_briefings_all') then
    create policy daily_briefings_all on daily_briefings using (is_member(shop_id)) with check (is_member(shop_id));
  end if;
end $$;

-- ---------- views (all security_invoker, so RLS applies) ----------
-- Sign convention matches party_balances: + the party owes the shop, − the shop owes the party.

-- P3.2: one row per confirmed entry of a party, with the running balance after it.
-- The window runs over the party's whole history before any outer date filter, so a filtered
-- statement still shows true running balances.
create or replace view party_statement with (security_invoker = true) as
select e.shop_id, e.party_id, e.id as entry_id, e.occurred_on, e.created_at, e.type, e.amount_paise,
       e.note, e.source, e.created_by,
       d.delta_paise,
       sum(d.delta_paise) over (partition by e.party_id
                                order by e.occurred_on, e.created_at, e.id
                                rows between unbounded preceding and current row) as running_balance_paise
from entries e
cross join lateral (select case e.type
    when 'credit_given'     then  e.amount_paise
    when 'payment_received' then -e.amount_paise
    when 'purchase_credit'  then -e.amount_paise
    when 'payment_made'     then  e.amount_paise
    else 0 end::bigint as delta_paise) d
where e.status = 'confirmed' and e.party_id is not null;

-- P6.2: per shop and day, confirmed entries only.
-- net_cash_paise = cash sales + collected − purchases paid − supplier paid − expenses.
-- outstanding_credit_paise = all customer credit given minus all collected, up to that day.
create or replace view daily_register with (security_invoker = true) as
select r.*,
       sum(r.credit_given_paise - r.collected_paise)
         over (partition by r.shop_id order by r.day rows between unbounded preceding and current row)
         as outstanding_credit_paise
from (
  select shop_id, occurred_on as day,
    coalesce(sum(amount_paise) filter (where type = 'cash_sale'), 0)::bigint        as cash_sales_paise,
    coalesce(sum(amount_paise) filter (where type = 'credit_given'), 0)::bigint     as credit_given_paise,
    coalesce(sum(amount_paise) filter (where type = 'payment_received'), 0)::bigint as collected_paise,
    coalesce(sum(amount_paise) filter (where type in ('purchase_credit', 'purchase_paid')), 0)::bigint as purchases_paise,
    coalesce(sum(amount_paise) filter (where type = 'purchase_paid'), 0)::bigint    as purchases_paid_paise,
    coalesce(sum(amount_paise) filter (where type = 'payment_made'), 0)::bigint     as supplier_paid_paise,
    coalesce(sum(amount_paise) filter (where type = 'expense'), 0)::bigint          as expenses_paise,
    (coalesce(sum(amount_paise) filter (where type in ('cash_sale', 'payment_received')), 0)
     - coalesce(sum(amount_paise) filter (where type in ('purchase_paid', 'payment_made', 'expense')), 0))::bigint
                                                                                     as net_cash_paise,
    count(*)::bigint as entry_count
  from entries
  where status = 'confirmed'
  group by shop_id, occurred_on
) r;

-- P6.2 weekly subtotal rows (Monday weeks; date_trunc('week') is ISO, Monday-first).
create or replace view weekly_register with (security_invoker = true) as
select shop_id, date_trunc('week', day)::date as week_start,
       sum(cash_sales_paise)::bigint as cash_sales_paise, sum(credit_given_paise)::bigint as credit_given_paise,
       sum(collected_paise)::bigint as collected_paise, sum(purchases_paise)::bigint as purchases_paise,
       sum(purchases_paid_paise)::bigint as purchases_paid_paise, sum(supplier_paid_paise)::bigint as supplier_paid_paise,
       sum(expenses_paise)::bigint as expenses_paise, sum(net_cash_paise)::bigint as net_cash_paise,
       sum(entry_count)::bigint as entry_count
from daily_register
group by shop_id, date_trunc('week', day);

-- P6.3: customers who owe the shop, aged. Rule (documented in DESIGN.md and the UI help):
-- age = days since the last payment_received, or since the first credit_given if they never paid.
-- "Today" is Asia/Kolkata.
create or replace view credit_aging with (security_invoker = true) as
with per as (
  select e.party_id,
         min(e.occurred_on) filter (where e.type = 'credit_given')     as first_credit_on,
         max(e.occurred_on) filter (where e.type = 'payment_received') as last_payment_on
  from entries e
  where e.status = 'confirmed' and e.party_id is not null
  group by e.party_id
), aged as (
  select b.shop_id, b.party_id, b.display_name, b.balance_paise, b.last_activity,
         per.first_credit_on, per.last_payment_on,
         coalesce(per.last_payment_on, per.first_credit_on, b.last_activity) as age_from,
         ((now() at time zone 'Asia/Kolkata')::date
           - coalesce(per.last_payment_on, per.first_credit_on, b.last_activity))::int as age_days
  from party_balances b
  join per on per.party_id = b.party_id
  where b.kind = 'customer' and b.balance_paise > 0
)
select aged.*,
       case when age_days <= 7 then '0-7' when age_days <= 30 then '8-30'
            when age_days <= 60 then '31-60' else '60+' end as bucket
from aged;

create or replace view credit_aging_totals with (security_invoker = true) as
select shop_id, bucket, count(*)::bigint as parties, sum(balance_paise)::bigint as total_paise
from credit_aging
group by shop_id, bucket;

-- P6.4: suppliers the shop owes. days = since the last payment_made, or since the first
-- purchase_credit if never paid.
create or replace view supplier_dues with (security_invoker = true) as
with per as (
  select e.party_id,
         min(e.occurred_on) filter (where e.type = 'purchase_credit') as first_purchase_on,
         max(e.occurred_on) filter (where e.type = 'payment_made')    as last_payment_on
  from entries e
  where e.status = 'confirmed' and e.party_id is not null
  group by e.party_id
)
select b.shop_id, b.party_id, b.display_name, (-b.balance_paise)::bigint as owed_paise, b.last_activity,
       per.first_purchase_on, per.last_payment_on,
       coalesce(per.last_payment_on, per.first_purchase_on, b.last_activity) as age_from,
       ((now() at time zone 'Asia/Kolkata')::date
         - coalesce(per.last_payment_on, per.first_purchase_on, b.last_activity))::int as days,
       ((now() at time zone 'Asia/Kolkata')::date - b.last_activity)::int as days_since_last_activity
from party_balances b
join per on per.party_id = b.party_id
where b.kind = 'supplier' and b.balance_paise < 0;

-- ---------- functions (security invoker: RLS applies; fixed search_path) ----------

-- P3.1: the ledger table's rows. Every filter is optional (null = any). Voided rows appear only
-- when p_statuses asks for them. p_q searches party names and notes.
create or replace function ledger_rows(
  p_shop uuid, p_from date default null, p_to date default null, p_types entry_type[] default null,
  p_party uuid default null, p_sources entry_source[] default null, p_member uuid default null,
  p_statuses entry_status[] default null, p_q text default null)
returns table (id uuid, occurred_on date, created_at timestamptz, type entry_type, amount_paise bigint,
               status entry_status, source entry_source, party_id uuid, party_name text, party_kind party_kind,
               note text, created_by uuid, confirmed_by uuid, auto_saved boolean, review_reason text,
               receipt_id uuid, voice_note_id uuid, expense_category text)
language sql stable security invoker set search_path = public as $$
  select e.id, e.occurred_on, e.created_at, e.type, e.amount_paise, e.status, e.source, e.party_id,
         p.display_name, p.kind, e.note, e.created_by, e.confirmed_by, e.auto_saved, e.review_reason,
         e.receipt_id, e.voice_note_id, e.expense_category
  from entries e
  left join parties p on p.id = e.party_id
  where e.shop_id = p_shop
    and (p_from is null or e.occurred_on >= p_from)
    and (p_to is null or e.occurred_on <= p_to)
    and (p_types is null or e.type = any(p_types))
    and (p_party is null or e.party_id = p_party)
    and (p_sources is null or e.source = any(p_sources))
    and (p_member is null or e.created_by = p_member)
    and (case when p_statuses is null then e.status <> 'voided' else e.status = any(p_statuses) end)
    and (p_q is null or btrim(p_q) = ''
         or e.note ilike '%' || btrim(p_q) || '%' or p.display_name ilike '%' || btrim(p_q) || '%');
$$;

-- P3.1 totals row: the same filters, confirmed entries only (pending and voided never count).
create or replace function ledger_totals(
  p_shop uuid, p_from date default null, p_to date default null, p_types entry_type[] default null,
  p_party uuid default null, p_sources entry_source[] default null, p_member uuid default null,
  p_statuses entry_status[] default null, p_q text default null)
returns table (cash_in_paise bigint, credit_given_paise bigint, collected_paise bigint, expenses_paise bigint,
               row_count bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(amount_paise) filter (where status = 'confirmed' and type = 'cash_sale'), 0)::bigint,
         coalesce(sum(amount_paise) filter (where status = 'confirmed' and type = 'credit_given'), 0)::bigint,
         coalesce(sum(amount_paise) filter (where status = 'confirmed' and type = 'payment_received'), 0)::bigint,
         coalesce(sum(amount_paise) filter (where status = 'confirmed' and type = 'expense'), 0)::bigint,
         count(*)::bigint
  from ledger_rows(p_shop, p_from, p_to, p_types, p_party, p_sources, p_member, p_statuses, p_q);
$$;

-- P6.5/P6.6: confirmed expenses by category in a date range (null category = 'uncategorised').
create or replace function expense_by_category(p_shop uuid, p_from date, p_to date)
returns table (category text, total_paise bigint, entry_count bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(expense_category, 'uncategorised'), sum(amount_paise)::bigint, count(*)::bigint
  from entries
  where shop_id = p_shop and status = 'confirmed' and type = 'expense' and occurred_on between p_from and p_to
  group by 1
  order by 2 desc, 1;
$$;

-- P6.7: per party, confirmed totals in a date range.
create or replace function party_period_totals(p_shop uuid, p_from date, p_to date)
returns table (party_id uuid, display_name text, kind party_kind, credit_given_paise bigint,
               collected_paise bigint, purchases_credit_paise bigint, supplier_paid_paise bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, p.display_name, p.kind,
         coalesce(sum(e.amount_paise) filter (where e.type = 'credit_given'), 0)::bigint,
         coalesce(sum(e.amount_paise) filter (where e.type = 'payment_received'), 0)::bigint,
         coalesce(sum(e.amount_paise) filter (where e.type = 'purchase_credit'), 0)::bigint,
         coalesce(sum(e.amount_paise) filter (where e.type = 'payment_made'), 0)::bigint
  from parties p
  join entries e on e.party_id = p.id and e.status = 'confirmed' and e.occurred_on between p_from and p_to
  where p.shop_id = p_shop
  group by p.id, p.display_name, p.kind;
$$;

-- P7.1 tip "an expense category is more than 40% above its 4-week average": this week's total
-- per category and the average of the 4 weeks before it (whole paise, rounded half up).
create or replace function expense_category_weeks(p_shop uuid, p_week_start date, p_today date)
returns table (category text, this_week_paise bigint, prev4_avg_paise bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(expense_category, 'uncategorised'),
         coalesce(sum(amount_paise) filter (where occurred_on between p_week_start and p_today), 0)::bigint,
         round(coalesce(sum(amount_paise) filter (where occurred_on >= p_week_start - 28
                                                  and occurred_on < p_week_start), 0) / 4.0)::bigint
  from entries
  where shop_id = p_shop and status = 'confirmed' and type = 'expense'
    and occurred_on between p_week_start - 28 and p_today
  group by 1;
$$;

-- P7.1 tip "a customer's credit this month is more than 2x their usual": credit given this month
-- so far, and the average per month over the 3 full months before it.
create or replace function customer_credit_usual(p_shop uuid, p_month_start date, p_today date)
returns table (party_id uuid, display_name text, this_month_paise bigint, usual_paise bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, p.display_name,
         coalesce(sum(e.amount_paise) filter (where e.occurred_on between p_month_start and p_today), 0)::bigint,
         round(coalesce(sum(e.amount_paise) filter (where e.occurred_on >= (p_month_start - interval '3 months')::date
                                                    and e.occurred_on < p_month_start), 0) / 3.0)::bigint
  from parties p
  join entries e on e.party_id = p.id and e.status = 'confirmed' and e.type = 'credit_given'
                and e.occurred_on between (p_month_start - interval '3 months')::date and p_today
  where p.shop_id = p_shop and p.kind = 'customer'
  group by p.id, p.display_name;
$$;

-- ---------- indexes for the ledger filters, statements and the activity feed ----------
create index if not exists entries_shop_created_idx   on entries (shop_id, created_at desc);
create index if not exists entries_shop_status_idx    on entries (shop_id, status);
create index if not exists entries_shop_type_idx      on entries (shop_id, type);
create index if not exists entries_shop_source_idx    on entries (shop_id, source);
create index if not exists entries_shop_member_idx    on entries (shop_id, created_by);
create index if not exists entries_party_date_idx     on entries (party_id, occurred_on, created_at) where status = 'confirmed';
create index if not exists entries_note_trgm_idx      on entries using gin (note gin_trgm_ops);
create index if not exists parties_display_trgm_idx   on parties using gin (display_name gin_trgm_ops);
create index if not exists audit_log_shop_at_idx      on audit_log (shop_id, at desc);
create index if not exists audit_log_entry_idx        on audit_log (entry_id);
create index if not exists voice_notes_shop_idx       on voice_notes (shop_id, created_at desc);
create index if not exists receipts_shop_created_idx  on receipts (shop_id, created_at desc);

-- ---------- P4.2 live sync ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['entries', 'parties', 'receipts'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
