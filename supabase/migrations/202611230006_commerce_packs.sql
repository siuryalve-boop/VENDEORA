-- Sales made with test keys must never grant access in the live storefront.
create table private.commerce_settings (
  singleton boolean primary key default true check (singleton),
  payment_mode text not null default 'test' check (payment_mode in ('test','live'))
);
insert into private.commerce_settings default values;
alter table private.commerce_settings enable row level security;

create function public.vendeora_commerce_mode() returns text
language sql stable security definer set search_path = '' as $$
  select payment_mode from private.commerce_settings where singleton
$$;
revoke all on function public.vendeora_commerce_mode() from public;
grant execute on function public.vendeora_commerce_mode() to anon, authenticated, service_role;

alter table public.orders add column payment_mode text not null default 'test' check(payment_mode in ('test','live')),
  add column platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0 and platform_fee_cents < amount_cents),
  add column provider_destination text check(provider_destination ~ '^acct_[a-zA-Z0-9]+$'),
  add column provider_intent text unique check(provider_intent ~ '^pi_[a-zA-Z0-9]+$'),
  add column checkout_title text;
grant select(payment_mode,platform_fee_cents) on public.orders to authenticated;
create policy order_environment on public.orders as restrictive for select to authenticated
  using (payment_mode = (select public.vendeora_commerce_mode()));

alter table public.commissions add column payment_mode text not null default 'test' check (payment_mode in ('test','live'));
create policy commission_active_test on public.commissions as restrictive for select to authenticated
  using (payment_mode = 'test' and (select public.vendeora_commerce_mode()) = 'test');

create or replace function private.record_order_commission() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_mode = 'test' and new.status = 'paid' and new.referral_id is not null and new.commission_percent > 0 then
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

create or replace function public.vendeora_customers(customer uuid default null)
returns table(id uuid, name text, email text, purchase_count bigint, total_cents bigint, first_purchase timestamptz, last_purchase timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.buyer_id, p.name, u.email::text, count(*), sum(o.amount_cents), min(o.paid_at), max(o.paid_at)
  from public.orders o
  join public.profiles p on p.id = o.buyer_id
  join auth.users u on u.id = o.buyer_id
  where (select public.vendeora_role()) = 'producer' and o.seller_id = (select auth.uid())
    and o.payment_mode = (select public.vendeora_commerce_mode())
    and o.status = 'paid' and (customer is null or o.buyer_id = customer)
  group by o.buyer_id, p.name, u.email
  order by max(o.paid_at) desc nulls last, o.buyer_id
  limit 500
$$;

create table private.stripe_accounts (
  producer_id uuid not null references public.profiles on delete restrict,
  payment_mode text not null check (payment_mode in ('test','live')),
  account_id text not null unique check (account_id ~ '^acct_[a-zA-Z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key(producer_id,payment_mode)
);
alter table private.stripe_accounts enable row level security;

create function public.vendeora_connect_binding(producer uuid, active_mode text, new_account text default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if active_mode not in ('test','live') or not exists(select 1 from public.profiles where id=producer and role='producer' and active) then
    raise insufficient_privilege using message='Producer is not eligible';
  end if;
  if new_account is not null then
    insert into private.stripe_accounts(producer_id,payment_mode,account_id) values(producer,active_mode,new_account)
    on conflict(producer_id,payment_mode) do nothing;
  end if;
  return (select account_id from private.stripe_accounts where producer_id=producer and payment_mode=active_mode);
end
$$;
revoke all on function public.vendeora_connect_binding(uuid,text,text) from public, anon, authenticated;
grant execute on function public.vendeora_connect_binding(uuid,text,text) to service_role;

create table private.payout_requests (
  producer_id uuid not null,
  payment_mode text not null,
  request_id uuid not null,
  amount_cents integer not null check (amount_cents between 100 and 10000000),
  stripe_payout_id text check (stripe_payout_id ~ '^po_[a-zA-Z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (producer_id,payment_mode,request_id),
  foreign key (producer_id,payment_mode) references private.stripe_accounts(producer_id,payment_mode)
);
alter table private.payout_requests enable row level security;

create function public.vendeora_payout_request(producer uuid, active_mode text, attempt uuid, amount integer, completed_payout text default null)
returns table(payout_id text, original_amount integer, started_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=producer and role='producer' and active) then raise insufficient_privilege; end if;
  insert into private.payout_requests(producer_id,payment_mode,request_id,amount_cents) values(producer,active_mode,attempt,amount)
    on conflict (producer_id,payment_mode,request_id) do nothing;
  if completed_payout is not null then
    update private.payout_requests p set stripe_payout_id=completed_payout
      where p.producer_id=producer and p.payment_mode=active_mode and p.request_id=attempt and p.amount_cents=amount
        and (p.stripe_payout_id is null or p.stripe_payout_id=completed_payout);
  end if;
  return query select p.stripe_payout_id,p.amount_cents,p.created_at from private.payout_requests p
    where p.producer_id=producer and p.payment_mode=active_mode and p.request_id=attempt;
end
$$;
revoke all on function public.vendeora_payout_request(uuid,text,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.vendeora_payout_request(uuid,text,uuid,integer,text) to service_role;

create function public.vendeora_payment_event_v2(event_id text, session_id text, order_id uuid, next_status text, amount integer, payment_currency text, event_mode text, payment_intent text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if next_status not in ('paid','failed','expired') or event_mode not in ('test','live') then return false; end if;
  if next_status='paid' and (payment_intent is null or payment_intent !~ '^pi_[a-zA-Z0-9]+$') then return false; end if;
  if not exists(select 1 from public.orders o where o.id=order_id and o.provider_session=session_id
    and o.amount_cents=amount and lower(o.currency)=payment_currency and o.payment_mode=event_mode) then return false; end if;
  insert into private.payment_events(provider_event) values(event_id) on conflict do nothing;
  if not found then return true; end if;
  update public.orders set status=next_status,
    provider_intent=case when next_status='paid' then payment_intent else provider_intent end,
    paid_at=case when next_status='paid' then now() else paid_at end
    where id=order_id and (status='pending' or status='failed' and next_status='paid');
  return true;
end
$$;
revoke all on function public.vendeora_payment_event_v2(text,text,uuid,text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.vendeora_payment_event_v2(text,text,uuid,text,integer,text,text,text) to service_role;

create or replace function public.vendeora_payment_event(event_id text, session_id text, order_id uuid, next_status text, amount integer, payment_currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if next_status not in ('paid','failed','expired') then return false; end if;
  if not exists(select 1 from public.orders o where o.id=order_id and o.provider_session=session_id
    and o.amount_cents=amount and lower(o.currency)=payment_currency and o.payment_mode='test') then return false; end if;
  insert into private.payment_events(provider_event) values(event_id) on conflict do nothing;
  if found then
    update public.orders set status=next_status, paid_at=case when next_status='paid' then now() else paid_at end
      where id=order_id and (status='pending' or status='failed' and next_status='paid');
  end if;
  return true;
end
$$;

create function public.vendeora_refund_event(event_id text, payment_intent text, original_amount integer, amount_refunded integer, payment_currency text, event_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare target_order uuid;
begin
  if amount_refunded <> original_amount or lower(payment_currency) <> 'brl' then return true; end if;
  select o.id into target_order from public.orders o where o.provider_intent=payment_intent and o.amount_cents=original_amount and o.payment_mode=event_mode;
  if target_order is null then return false; end if;
  insert into private.payment_events(provider_event) values(event_id) on conflict do nothing;
  if found then update public.orders set status='refunded' where id=target_order and status='paid'; end if;
  return true;
end
$$;
revoke all on function public.vendeora_refund_event(text,text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.vendeora_refund_event(text,text,integer,integer,text,text) to service_role;

alter table public.products add column pack_slug text check (pack_slug ~ '^[a-z0-9-]{3,60}$');
create unique index products_producer_pack_idx on public.products(owner_id,pack_slug) where pack_slug is not null and not archived;

create table public.pack_files (
  product_id uuid not null references public.products,
  filename text not null check (filename ~ '^[a-z0-9-]{1,70}\.(md|csv|txt)$'),
  content text not null check(octet_length(content) between 1 and 32000),
  primary key(product_id,filename)
);
alter table public.pack_files enable row level security;
revoke all on public.pack_files from public, anon, authenticated;
grant select,insert(product_id,filename,content) on public.pack_files to authenticated;
create policy pack_files_insert on public.pack_files for insert to authenticated with check (
  (select public.vendeora_role())='producer' and exists(select 1 from public.products p where p.id=product_id and p.owner_id=(select auth.uid()) and p.pack_slug is not null and not p.active and not p.archived)
);
create policy pack_files_read on public.pack_files for select to authenticated using (
  (select public.vendeora_role()) is not null and (
    exists(select 1 from public.products p where p.id=product_id and p.owner_id=(select auth.uid())) or
    exists(select 1 from public.orders o where o.product_id=pack_files.product_id and o.buyer_id=(select auth.uid()) and o.status='paid')
  )
);

create function public.vendeora_create_pack(template_slug text, template_title text, template_description text, template_price integer, materials jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare pack_id uuid;
begin
  if (select public.vendeora_role()) is distinct from 'producer' then raise insufficient_privilege; end if;
  if jsonb_typeof(materials) is distinct from 'array' or jsonb_array_length(materials) not between 1 and 12 then
    raise check_violation using message='Invalid pack files';
  end if;
  insert into public.products(title,description,price_cents,category,pack_slug)
    values(template_title,template_description,template_price,'Outros',template_slug) returning id into pack_id;
  insert into public.pack_files(product_id,filename,content)
    select pack_id,x.filename,x.content from jsonb_to_recordset(materials) x(filename text,content text);
  return pack_id;
end
$$;
revoke all on function public.vendeora_create_pack(text,text,text,integer,jsonb) from public, anon;
grant execute on function public.vendeora_create_pack(text,text,text,integer,jsonb) to authenticated;

create function public.vendeora_pack_library(requested_product uuid default null)
returns table(product_id uuid, title text, pack_slug text, file_count bigint)
language sql stable security definer set search_path = '' as $$
  select p.id,p.title,p.pack_slug,count(f.filename)
  from public.products p join public.pack_files f on f.product_id=p.id
  where (select public.vendeora_role()) is not null and (requested_product is null or p.id=requested_product)
    and (p.owner_id=(select auth.uid()) or exists(select 1 from public.orders o
      where o.product_id=p.id and o.buyer_id=(select auth.uid()) and o.status='paid' and o.payment_mode=(select public.vendeora_commerce_mode())))
  group by p.id,p.title,p.pack_slug order by p.title,p.id limit 250
$$;
revoke all on function public.vendeora_pack_library(uuid) from public, anon;
grant execute on function public.vendeora_pack_library(uuid) to authenticated;
