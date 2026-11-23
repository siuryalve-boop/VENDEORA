alter policy profile_read on public.profiles using (
  id = (select auth.uid()) and (select public.vendeora_role()) is not null or
  (select public.vendeora_role()) = 'admin' and (select auth.jwt()->>'aal') = 'aal2'
);
alter policy product_read on public.products using (
  owner_id = (select auth.uid()) and (select public.vendeora_role()) = 'producer' or
  (select public.vendeora_role()) = 'admin' and (select auth.jwt()->>'aal') = 'aal2' or
  (select public.vendeora_role()) = 'affiliate' and active and not archived and affiliates_enabled
);
alter policy order_read on public.orders using ((select public.vendeora_role()) is not null and (
  (select auth.uid()) in (seller_id, buyer_id) or (select public.vendeora_role()) = 'admin' and (select auth.jwt()->>'aal') = 'aal2'
));
alter policy privacy_request_read on public.privacy_requests using (
  user_id = (select auth.uid()) and (select public.vendeora_role()) is not null or
  (select public.vendeora_role()) = 'admin' and (select auth.jwt()->>'aal') = 'aal2'
);

create function public.vendeora_change_account(account uuid, enable_account boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (select public.vendeora_role()) is distinct from 'admin' or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise insufficient_privilege using message = 'Administrator MFA required';
  end if;
  update public.profiles set active = enable_account where id = account and role <> 'admin';
  if not found then return false; end if;
  insert into private.platform_audit(actor_id,action,target_id) values ((select auth.uid()),case when enable_account then 'account_activated' else 'account_suspended' end,account);
  return true;
end
$$;
revoke all on function public.vendeora_change_account(uuid,boolean) from public, anon;
grant execute on function public.vendeora_change_account(uuid,boolean) to authenticated;

create table public.checkouts (
  product_id uuid primary key references public.products,
  headline text not null default '' check(length(headline) <= 140),
  accent text not null default '#D94E0B' check(accent ~ '^#[0-9A-Fa-f]{6}$')
);
alter table public.checkouts enable row level security;
revoke all on public.checkouts from anon, authenticated;
grant select, insert(product_id,headline,accent), update(headline,accent) on public.checkouts to authenticated;
create policy checkout_owner on public.checkouts for all to authenticated
  using ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
  with check ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())));

create function public.vendeora_save_checkout(product uuid, new_headline text, new_accent text)
returns void language sql security invoker set search_path = '' as $$
  insert into public.checkouts(product_id,headline,accent) values (product,new_headline,new_accent)
  on conflict(product_id) do update set headline=excluded.headline,accent=excluded.accent
$$;
revoke all on function public.vendeora_save_checkout(uuid,text,text) from public, anon;
grant execute on function public.vendeora_save_checkout(uuid,text,text) to authenticated;

create function public.vendeora_checkout_style(product uuid)
returns table(headline text, accent text) language sql stable security definer set search_path = '' as $$
  select c.headline, c.accent from public.checkouts c where c.product_id = product
    and exists (select 1 from public.vendeora_offer(product))
$$;
revoke all on function public.vendeora_checkout_style(uuid) from public;
grant execute on function public.vendeora_checkout_style(uuid) to anon, authenticated;

create table public.coupons (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
  code text not null check(code ~ '^[A-Z0-9-]{3,32}$'), percent integer not null check(percent between 1 and 90), active boolean not null default true,
  created_at timestamptz not null default now(), unique(product_id,code)
);
alter table public.coupons enable row level security;
revoke all on public.coupons from anon, authenticated;
grant select, insert(product_id,code,percent), update(active) on public.coupons to authenticated;
create policy coupon_owner on public.coupons for all to authenticated
  using ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
  with check ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())));

alter table public.orders add column applied_coupon_id uuid references public.coupons;
create function public.vendeora_checkout_quote(product uuid, requested_code text)
returns table(coupon_id uuid, amount_cents integer)
language sql stable security definer set search_path = '' as $$
  select c.id, greatest(500, o.price_cents - (o.price_cents * c.percent / 100))
  from public.vendeora_offer(product) o join public.coupons c on c.product_id = o.id
  where (select public.vendeora_role()) is not null and c.active and c.code = upper(trim(requested_code))
    and o.price_cents > 500 and o.price_cents * c.percent >= 100
$$;
revoke all on function public.vendeora_checkout_quote(uuid,text) from public, anon;
grant execute on function public.vendeora_checkout_quote(uuid,text) to authenticated;
