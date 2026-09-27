-- 005: the whole dashboard in one round trip (GOAL_2.0 P6 AC: under 1.5 s). Additive only: one new
-- function. It assembles the 003 views and 004 functions into the GET /dashboard shape, so every
-- number is still computed by those (the API passes this through). Security invoker with a fixed
-- search_path: RLS applies, and another shop's id returns zeros and empty lists.
-- Measured before: nine parallel PostgREST calls, ~200 ms each from the app server, ~550 ms in all
-- with connection setup; one call is ~250 ms.
create or replace function dashboard_json(p_shop uuid, p_today date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with d as (select (p_today - 29) as start, date_trunc('month', p_today)::date as m0)
  select jsonb_build_object(
    'today', p_today,
    'strip', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from today_vs_last_week(p_shop, p_today) s),
    'register', jsonb_build_object(
      'from', d.start, 'to', p_today,
      'days', (select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb)
               from register_days(p_shop, d.start, p_today) x),
      'weeks', (select coalesce(jsonb_agg(to_jsonb(w) order by w.week_start), '[]'::jsonb)
                from register_weeks(p_shop, d.start, p_today) w)),
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
    'expenses', jsonb_build_object(
      'from', d.m0, 'to', p_today,
      'rows', (select coalesce(jsonb_agg(to_jsonb(e) order by e.total_paise desc, e.category), '[]'::jsonb)
               from expense_by_category(p_shop, d.m0, p_today) e)),
    'top_customers', jsonb_build_object(
      'from', d.m0, 'to', p_today,
      'by_credit', (select coalesce(jsonb_agg(to_jsonb(x) order by x.credit_given_paise desc, x.display_name), '[]'::jsonb)
                    from (select * from party_period_totals(p_shop, d.m0, p_today)
                          where kind = 'customer' and credit_given_paise > 0
                          order by credit_given_paise desc, display_name limit 5) x),
      'by_collections', (select coalesce(jsonb_agg(to_jsonb(x) order by x.collected_paise desc, x.display_name), '[]'::jsonb)
                         from (select * from party_period_totals(p_shop, d.m0, p_today)
                               where kind = 'customer' and collected_paise > 0
                               order by collected_paise desc, display_name limit 5) x)))
  from d;
$$;
