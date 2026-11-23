alter table public.products add column commission_percent integer not null default 0 check(commission_percent between 0 and 80);
grant update(commission_percent) on public.products to authenticated;
alter table public.affiliate_requests add column visits bigint not null default 0 check(visits >= 0);
alter table public.orders add column referral_id uuid references public.affiliate_requests;
alter table public.orders add column commission_percent integer not null default 0 check(commission_percent between 0 and 80);

create function private.eligible_referral(product uuid, referral uuid)
returns table(id uuid, affiliate_id uuid, commission_percent integer)
language sql stable security definer set search_path = '' as $$
  select a.id,a.affiliate_id,p.commission_percent
  from public.affiliate_requests a join public.products p on p.id=a.product_id
    join public.profiles f on f.id=a.affiliate_id and f.active and f.role='affiliate'
  where a.id=referral and a.product_id=product and a.status='approved' and p.affiliates_enabled
    and exists (select 1 from public.vendeora_offer(product))
$$;
revoke all on function private.eligible_referral(uuid,uuid) from public, anon, authenticated;

create function public.vendeora_referral_click(product uuid, referral uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.affiliate_requests set visits=visits+1 where id=(select r.id from private.eligible_referral(product,referral) r);
  return found;
end
$$;
revoke all on function public.vendeora_referral_click(uuid,uuid) from public;
grant execute on function public.vendeora_referral_click(uuid,uuid) to anon, authenticated;

create function public.vendeora_checkout_referral(product uuid, referral uuid)
returns table(id uuid, commission_percent integer) language sql stable security definer set search_path = '' as $$
  select a.id,a.commission_percent from private.eligible_referral(product,referral) a
    where (select public.vendeora_role()) is not null and a.affiliate_id <> (select auth.uid())
$$;
revoke all on function public.vendeora_checkout_referral(uuid,uuid) from public, anon;
grant execute on function public.vendeora_checkout_referral(uuid,uuid) to authenticated;

create table public.commissions (
  order_id uuid primary key references public.orders,
  affiliate_id uuid not null references public.profiles,
  seller_id uuid not null references public.profiles,
  product_id uuid not null references public.products,
  amount_cents integer not null check(amount_cents >= 0),
  status text not null default 'approved' check(status in ('approved','reversed')),
  created_at timestamptz not null default now()
);
create index commissions_affiliate_idx on public.commissions(affiliate_id,created_at desc);
create index commissions_seller_idx on public.commissions(seller_id,created_at desc);
alter table public.commissions enable row level security;
revoke all on public.commissions from public, anon, authenticated;
grant select on public.commissions to authenticated;
create policy commission_read on public.commissions for select to authenticated using (
 (select public.vendeora_role())='affiliate' and affiliate_id=(select auth.uid()) or
 (select public.vendeora_role())='producer' and seller_id=(select auth.uid())
);

create function private.record_order_commission() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='paid' and new.referral_id is not null and new.commission_percent>0 then
    insert into public.commissions(order_id,affiliate_id,seller_id,product_id,amount_cents)
      select new.id,a.affiliate_id,new.seller_id,new.product_id,new.amount_cents*new.commission_percent/100
      from public.affiliate_requests a where a.id=new.referral_id and a.product_id=new.product_id and a.affiliate_id<>new.buyer_id
      on conflict(order_id) do nothing;
  elsif new.status='refunded' then
    update public.commissions set status='reversed' where order_id=new.id;
  end if;
  return new;
end
$$;
revoke all on function private.record_order_commission() from public, anon, authenticated;
create trigger vendeora_commission_for_paid_orders after update of status on public.orders
  for each row when(old.status is distinct from new.status) execute function private.record_order_commission();
