create function public.vendeora_producer_metrics(period_days integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with limits as (
    select now() as ends, now() - make_interval(days => period_days) as starts,
      now() - make_interval(days => period_days * 2) as previous_starts,
      date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as day_starts,
      date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as month_starts
    where period_days in (1,7,30,90) and (select public.vendeora_role()) = 'producer'
  ), sales as (
    select o.product_id, o.status, o.amount_cents, o.created_at, o.paid_at
    from public.orders o
    where o.seller_id = (select auth.uid())
  ), totals as (
    select coalesce(sum(amount_cents) filter (where status='paid' and paid_at >= day_starts and paid_at <= ends),0) as today,
      coalesce(sum(amount_cents) filter (where status='paid' and paid_at >= month_starts and paid_at <= ends),0) as month,
      coalesce(sum(amount_cents) filter (where status='paid' and paid_at <= ends),0) as lifetime,
      coalesce(sum(amount_cents) filter (where status='paid' and paid_at >= starts and paid_at < ends),0) as current_gross,
      coalesce(sum(amount_cents) filter (where status='paid' and paid_at >= previous_starts and paid_at < starts),0) as previous_gross,
      count(*) filter (where status='failed' and created_at >= starts and created_at < ends) as declined
    from limits cross join sales
  ), ranking as (
    select s.product_id, p.title, count(*) as quantity, sum(s.amount_cents) as gross_cents
    from limits l cross join sales s join public.products p on p.id=s.product_id
    where s.status='paid' and s.paid_at >= l.starts and s.paid_at < l.ends
    group by s.product_id,p.title
    order by quantity desc,gross_cents desc,s.product_id
    limit 5
  )
  select jsonb_build_object(
    'today_cents', today, 'month_cents', month, 'lifetime_cents', lifetime,
    'current_gross', current_gross, 'previous_gross', previous_gross, 'declined', declined,
    'top_products', coalesce((select jsonb_agg(r order by r.quantity desc,r.gross_cents desc,r.product_id) from ranking r),'[]'::jsonb)
  )
  from totals where exists(select 1 from limits)
$$;
revoke all on function public.vendeora_producer_metrics(integer) from public, anon;
grant execute on function public.vendeora_producer_metrics(integer) to authenticated;
