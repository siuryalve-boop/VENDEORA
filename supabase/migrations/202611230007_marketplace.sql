create index orders_marketplace_paid_idx on public.orders(product_id)
  where payment_mode = 'live' and status = 'paid';

create function public.vendeora_marketplace(search_term text default '', product_category text default '', ranking text default 'popular')
returns table(
  id uuid, title text, description text, category text, price_cents integer,
  affiliates_enabled boolean, commission_percent integer, sales_count bigint,
  owned boolean, application_status text, affiliate_link_id uuid
)
language sql stable security definer set search_path = '' as $$
  with input as (
    select (select auth.uid()) as user_id, (select public.vendeora_role()) as role
  )
  select p.id, p.title, p.description, p.category, p.price_cents,
    p.affiliates_enabled, p.commission_percent::integer, sales.quantity,
    p.owner_id = i.user_id, a.status, case when a.status = 'approved' then a.id end
  from public.products p
  cross join input i
  left join public.affiliate_requests a on i.role = 'affiliate'
    and a.product_id = p.id and a.affiliate_id = i.user_id
  cross join lateral (
    select count(*) as quantity from public.orders o
    where o.product_id = p.id and o.payment_mode = 'live' and o.status = 'paid'
  ) sales
  where i.role is not null and p.active and not p.archived
    and exists (select 1 from public.profiles seller where seller.id = p.owner_id and seller.active)
    and (product_category = '' or p.category = product_category)
    and (search_term = '' or strpos(lower(p.title), lower(left(search_term,120))) > 0
      or strpos(lower(p.description), lower(left(search_term,120))) > 0)
  order by case when ranking = 'popular' then sales.quantity end desc nulls last,
    p.created_at desc, p.id
  limit 100
$$;
revoke all on function public.vendeora_marketplace(text,text,text) from public, anon;
grant execute on function public.vendeora_marketplace(text,text,text) to authenticated;

create function public.vendeora_sales_overview(period_days integer)
returns table(approved bigint, pending bigint, gross_cents bigint, fee_cents bigint, refunded bigint, buckets bigint[], payment_mode text)
language sql stable security invoker set search_path = '' as $$
  with period as (
    select now() - make_interval(days => period_days) as starts,
      now() as ends, case when period_days=1 then 12 else 10 end as bucket_count
    where period_days in (1,7,30,90) and (select public.vendeora_role()) = 'producer'
  ), filtered as (
    select o.status, o.amount_cents, o.platform_fee_cents,
      width_bucket(extract(epoch from o.created_at),extract(epoch from p.starts),
        extract(epoch from p.ends),p.bucket_count) as bucket
    from public.orders o cross join period p
    where o.seller_id = (select auth.uid()) and o.created_at >= p.starts and o.created_at < p.ends
  ), chart as (
    select n as bucket, coalesce(sum(f.amount_cents),0) as gross
    from period p cross join lateral generate_series(1,p.bucket_count) n
    left join filtered f on f.bucket = n and f.status = 'paid'
    group by n
  )
  select count(*) filter (where status='paid'), count(*) filter (where status='pending'),
    coalesce(sum(amount_cents) filter (where status='paid'),0),
    coalesce(sum(platform_fee_cents) filter (where status='paid'),0),
    count(*) filter (where status='refunded'),
    array(select gross from chart order by bucket),
    (select public.vendeora_commerce_mode())
  from filtered
$$;
revoke all on function public.vendeora_sales_overview(integer) from public, anon;
grant execute on function public.vendeora_sales_overview(integer) to authenticated;
