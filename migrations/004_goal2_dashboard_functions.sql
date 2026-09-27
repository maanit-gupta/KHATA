-- 004: dashboard functions (GOAL_2.0 P6). Additive only: new functions, nothing dropped, renamed
-- or retyped. Security invoker with a fixed search_path, like every function in 003, so RLS decides
-- what a caller can read: another shop's id returns no rows.
-- Every number the dashboard shows comes from these functions or the 003 views (P6: "all numbers
-- come from SQL"); the API only passes them through.

-- P6.2: every day in [p_from, p_to], zero-filled, from daily_register (confirmed entries only).
-- outstanding_credit_paise = customers' credit given minus collections, carried forward from
-- before the range: the "outstanding credit over time" line (P6.5).
-- net_cash_paise = cash sales + collected - purchases paid - supplier paid - expenses.
create or replace function register_days(p_shop uuid, p_from date, p_to date)
returns table (day date, week_start date, cash_sales_paise bigint, credit_given_paise bigint,
               collected_paise bigint, purchases_paise bigint, purchases_paid_paise bigint,
               supplier_paid_paise bigint, expenses_paise bigint, net_cash_paise bigint,
               entry_count bigint, outstanding_credit_paise bigint)
language sql stable security invoker set search_path = public as $$
  with days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ), opening as (
    select coalesce(sum(credit_given_paise - collected_paise), 0)::bigint as v
    from daily_register where shop_id = p_shop and day < p_from
  )
  select days.day,
         date_trunc('week', days.day)::date,
         coalesce(r.cash_sales_paise, 0)::bigint,
         coalesce(r.credit_given_paise, 0)::bigint,
         coalesce(r.collected_paise, 0)::bigint,
         coalesce(r.purchases_paise, 0)::bigint,
         coalesce(r.purchases_paid_paise, 0)::bigint,
         coalesce(r.supplier_paid_paise, 0)::bigint,
         coalesce(r.expenses_paise, 0)::bigint,
         coalesce(r.net_cash_paise, 0)::bigint,
         coalesce(r.entry_count, 0)::bigint,
         (opening.v + sum(coalesce(r.credit_given_paise, 0) - coalesce(r.collected_paise, 0))
                        over (order by days.day rows between unbounded preceding and current row))::bigint
  from days
  cross join opening
  left join daily_register r on r.shop_id = p_shop and r.day = days.day
  order by days.day;
$$;

-- P6.2 weekly subtotal rows: Mon-Sun weeks, counting only the days inside [p_from, p_to] (the
-- first and last week of a 30-day window are usually partial; first_day / last_day say so).
create or replace function register_weeks(p_shop uuid, p_from date, p_to date)
returns table (week_start date, first_day date, last_day date, cash_sales_paise bigint,
               credit_given_paise bigint, collected_paise bigint, purchases_paise bigint,
               purchases_paid_paise bigint, supplier_paid_paise bigint, expenses_paise bigint,
               net_cash_paise bigint, entry_count bigint)
language sql stable security invoker set search_path = public as $$
  select week_start, min(day), max(day),
         sum(cash_sales_paise)::bigint, sum(credit_given_paise)::bigint, sum(collected_paise)::bigint,
         sum(purchases_paise)::bigint, sum(purchases_paid_paise)::bigint, sum(supplier_paid_paise)::bigint,
         sum(expenses_paise)::bigint, sum(net_cash_paise)::bigint, sum(entry_count)::bigint
  from register_days(p_shop, p_from, p_to)
  group by week_start
  order by week_start;
$$;

-- P6.1 today strip: four figures for p_today and the same weekday a week earlier, with the change.
create or replace function today_vs_last_week(p_shop uuid, p_today date)
returns table (metric text, today_paise bigint, last_week_paise bigint, change_paise bigint)
language sql stable security invoker set search_path = public as $$
  select m.metric, m.today_v, m.last_v, (m.today_v - m.last_v)::bigint
  from register_days(p_shop, p_today, p_today) t,
       register_days(p_shop, p_today - 7, p_today - 7) l,
       lateral (values (1, 'cash_sales', t.cash_sales_paise, l.cash_sales_paise),
                       (2, 'credit_given', t.credit_given_paise, l.credit_given_paise),
                       (3, 'collected', t.collected_paise, l.collected_paise),
                       (4, 'expenses', t.expenses_paise, l.expenses_paise)) m(ord, metric, today_v, last_v)
  order by m.ord;
$$;

-- P7.1 tip facts. Code decides which tips fire (thresholds live in app/tips.py); these return the
-- numbers a tip may say.

-- Collections this week so far vs the same days of last week (Mon..same weekday), so a Monday is
-- not compared with a whole week.
create or replace function collections_vs_last_week(p_shop uuid, p_week_start date, p_today date)
returns table (this_week_paise bigint, last_week_paise bigint, drop_paise bigint)
language sql stable security invoker set search_path = public as $$
  select x.this_week, x.last_week, (x.last_week - x.this_week)::bigint
  from (
    select coalesce(sum(collected_paise) filter (where day between p_week_start and p_today), 0)::bigint as this_week,
           coalesce(sum(collected_paise) filter (where day between p_week_start - 7 and p_today - 7), 0)::bigint as last_week
    from register_days(p_shop, p_week_start - 7, p_today)
  ) x;
$$;

-- An expense category this week vs its 4-week average, with the excess.
create or replace function expense_category_excess(p_shop uuid, p_week_start date, p_today date)
returns table (category text, this_week_paise bigint, prev4_avg_paise bigint, excess_paise bigint)
language sql stable security invoker set search_path = public as $$
  select category, this_week_paise, prev4_avg_paise, (this_week_paise - prev4_avg_paise)::bigint
  from expense_category_weeks(p_shop, p_week_start, p_today);
$$;

-- A customer's credit this month vs their usual month, with the excess.
create or replace function customer_credit_excess(p_shop uuid, p_month_start date, p_today date)
returns table (party_id uuid, display_name text, this_month_paise bigint, usual_paise bigint, excess_paise bigint)
language sql stable security invoker set search_path = public as $$
  select party_id, display_name, this_month_paise, usual_paise, (this_month_paise - usual_paise)::bigint
  from customer_credit_usual(p_shop, p_month_start, p_today);
$$;
