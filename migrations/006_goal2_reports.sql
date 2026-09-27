-- 006: facts for tips, summaries, the daily briefing and the printable report (GOAL_2.0 P7).
-- Additive only: new functions. Security invoker, fixed search_path: RLS applies, and another
-- shop's id returns zeros and empty lists. "SQL decides every fact and number": these return every
-- number a tip, a summary, the briefing or the report may state; app/tips.py only decides which
-- tips fire (thresholds) and ranks them.

-- Confirmed totals over [p_from, p_to] (one row, zeros when empty).
create or replace function period_totals(p_shop uuid, p_from date, p_to date)
returns table (cash_sales_paise bigint, credit_given_paise bigint, collected_paise bigint,
               purchases_paise bigint, purchases_paid_paise bigint, supplier_paid_paise bigint,
               expenses_paise bigint, net_cash_paise bigint, entry_count bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cash_sales_paise), 0)::bigint, coalesce(sum(credit_given_paise), 0)::bigint,
         coalesce(sum(collected_paise), 0)::bigint, coalesce(sum(purchases_paise), 0)::bigint,
         coalesce(sum(purchases_paid_paise), 0)::bigint, coalesce(sum(supplier_paid_paise), 0)::bigint,
         coalesce(sum(expenses_paise), 0)::bigint, coalesce(sum(net_cash_paise), 0)::bigint,
         coalesce(sum(entry_count), 0)::bigint
  from register_days(p_shop, p_from, p_to);
$$;

-- P7.1 / P7.4: everything the tip rules and the briefing read, in one round trip.
create or replace function tip_facts_json(p_shop uuid, p_today date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with d as (select date_trunc('week', p_today)::date as ws, date_trunc('month', p_today)::date as m0)
  select jsonb_build_object(
    'today', p_today, 'week_start', d.ws, 'month_start', d.m0,
    'aging', (select coalesce(jsonb_agg(jsonb_build_object(
                'party_id', a.party_id, 'name', a.display_name, 'balance_paise', a.balance_paise,
                'age_days', a.age_days, 'last_payment_on', a.last_payment_on)
                order by a.balance_paise desc, a.display_name), '[]'::jsonb)
              from credit_aging a where a.shop_id = p_shop),
    'collections', (select to_jsonb(c) from collections_vs_last_week(p_shop, d.ws, p_today) c),
    'expense_excess', (select coalesce(jsonb_agg(to_jsonb(e) order by e.excess_paise desc, e.category), '[]'::jsonb)
                       from expense_category_excess(p_shop, d.ws, p_today) e),
    'credit_excess', (select coalesce(jsonb_agg(to_jsonb(x) order by x.excess_paise desc, x.display_name), '[]'::jsonb)
                      from customer_credit_excess(p_shop, d.m0, p_today) x),
    'dues', (select coalesce(jsonb_agg(jsonb_build_object(
               'party_id', s.party_id, 'name', s.display_name, 'owed_paise', s.owed_paise,
               'days_since_last_activity', s.days_since_last_activity)
               order by s.owed_paise desc, s.display_name), '[]'::jsonb)
             from supplier_dues s where s.shop_id = p_shop),
    'week_days', (select coalesce(jsonb_agg(jsonb_build_object('day', r.day, 'net_cash_paise', r.net_cash_paise)
                                            order by r.day), '[]'::jsonb)
                  from register_days(p_shop, d.ws, p_today) r),
    'yesterday', (select to_jsonb(y) from period_totals(p_shop, p_today - 1, p_today - 1) y),
    'pending_review', (select count(*) from review_queue q where q.shop_id = p_shop),
    'pending_paise', (select coalesce(sum(e.amount_paise), 0)::bigint from entries e
                      where e.shop_id = p_shop and e.status = 'pending'))
  from d;
$$;

-- P7.2: a period's figures so far and the same stretch of the period before (day: the same
-- weekday last week; week: Monday..same weekday last week; month: the 1st..same date last month),
-- plus the tip facts.
create or replace function summary_facts_json(p_shop uuid, p_period text, p_today date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with r as (
    select case p_period when 'day' then p_today when 'week' then date_trunc('week', p_today)::date
                         else date_trunc('month', p_today)::date end as cur_from,
           case p_period when 'day' then p_today - 7 when 'week' then date_trunc('week', p_today)::date - 7
                         else (date_trunc('month', p_today) - interval '1 month')::date end as prev_from,
           case p_period when 'month' then (p_today - interval '1 month')::date else p_today - 7 end as prev_to
  )
  select tip_facts_json(p_shop, p_today) || jsonb_build_object(
    'period', p_period,
    'current_from', r.cur_from, 'current_to', p_today,
    'previous_from', r.prev_from, 'previous_to', r.prev_to,
    'current', (select to_jsonb(c) from period_totals(p_shop, r.cur_from, p_today) c),
    'previous', (select to_jsonb(p) from period_totals(p_shop, r.prev_from, r.prev_to) p))
  from r;
$$;

-- P7.3: the printable report for [p_from, p_to].
create or replace function report_json(p_shop uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'totals', (select to_jsonb(t) from period_totals(p_shop, p_from, p_to) t),
    'register', jsonb_build_object(
      'days', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) from register_days(p_shop, p_from, p_to) x),
      'weeks', (select coalesce(jsonb_agg(to_jsonb(w) order by w.week_start), '[]'::jsonb) from register_weeks(p_shop, p_from, p_to) w)),
    'aging', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(to_jsonb(a) - 'shop_id' - 'last_activity'
                                         order by a.balance_paise desc, a.display_name), '[]'::jsonb)
               from credit_aging a where a.shop_id = p_shop),
      'buckets', (select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'parties', coalesce(t.parties, 0),
                                                      'total_paise', coalesce(t.total_paise, 0)) order by b.ord)
                  from (values (1, '0-7'), (2, '8-30'), (3, '31-60'), (4, '60+')) b(ord, bucket)
                  left join credit_aging_totals t on t.shop_id = p_shop and t.bucket = b.bucket)),
    'dues', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(to_jsonb(s) - 'shop_id' - 'last_activity'
                                         order by s.owed_paise desc, s.display_name), '[]'::jsonb)
               from supplier_dues s where s.shop_id = p_shop)),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(e) order by e.total_paise desc, e.category), '[]'::jsonb)
                 from expense_by_category(p_shop, p_from, p_to) e));
$$;
