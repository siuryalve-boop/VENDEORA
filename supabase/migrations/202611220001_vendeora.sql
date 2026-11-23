create extension if not exists pgcrypto with schema extensions;
create schema private;
revoke all on schema private from public, anon, authenticated;

create table private.identity_key (id boolean primary key default true check (id), secret bytea not null);
insert into private.identity_key(secret) values (extensions.gen_random_bytes(32));

create table private.identities (
  user_id uuid primary key references auth.users on delete cascade deferrable initially deferred,
  cpf_digest bytea not null unique, birth_date date not null, phone text not null,
  terms_version text not null, terms_accepted_at timestamptz not null default now(),
  identity_status text not null default 'unverified' check (identity_status in ('unverified','verified','rejected')),
  identity_provider text, identity_reference text
);
alter table private.identities enable row level security;
alter table private.identity_key enable row level security;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade, name text not null check (length(trim(name)) between 3 and 120),
  role text not null check (role in ('producer','affiliate','student','admin')), active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function private.valid_cpf(cpf text) returns boolean language sql immutable set search_path = '' as $$
  select case when cpf !~ '^[0-9]{11}$' or cpf ~ '^([0-9])\1{10}$' then false else (
    select bool_and(((sum_digits * 10) % 11) % 10 = substring(cpf, position + 1, 1)::integer)
    from (select p as position, sum(substring(cpf, i, 1)::integer * (p + 1 - i)) as sum_digits
      from (values (9), (10)) checks(p) cross join lateral generate_series(1, p) i group by p) sums
  ) end
$$;

create function private.capture_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  input jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  cpf text := coalesce(input->>'cpf', '');
  birthday date;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  phone text := coalesce(input->>'phone', '');
  account_role text := coalesce(input->>'account_role', '');
  legal_name text := trim(coalesce(input->>'name', ''));
begin
  if new.email is null or coalesce(input->>'birth', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid registration';
  end if;
  birthday := (input->>'birth')::date;
  if birthday < date '1900-01-01' or birthday > today or
      (extract(year from today) - extract(year from birthday) - case when to_char(today, 'MMDD') < to_char(birthday, 'MMDD') then 1 else 0 end) < 18 or
      not private.valid_cpf(cpf) or phone !~ '^([1-9][1-9])(9[0-9]{8}|[2-5][0-9]{7})$' or
      coalesce(input->>'terms_version','') <> '2026-11-22' or
      account_role not in ('producer','affiliate','student') or length(legal_name) not between 3 and 120 or position(' ' in legal_name) = 0 then
    raise exception 'Invalid registration';
  end if;
  insert into private.identities(user_id, cpf_digest, birth_date, phone, terms_version)
    select new.id, extensions.hmac(convert_to(cpf,'UTF8'), secret, 'sha256'), birthday, phone, '2026-11-22' from private.identity_key where id;
  new.raw_user_meta_data := jsonb_build_object('name', legal_name, 'signup_role', account_role);
  return new;
end
$$;

create function private.create_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,name,role) values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'signup_role');
  return new;
end
$$;
create trigger vendeora_capture_signup before insert on auth.users for each row execute function private.capture_signup();
create trigger vendeora_create_profile after insert on auth.users for each row execute function private.create_profile();

create function public.vendeora_role() returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p join auth.users u on u.id = p.id
    join private.identities i on i.user_id = p.id
    where p.id = (select auth.uid()) and p.active and u.email_confirmed_at is not null and i.identity_status <> 'rejected'
      and (select auth.jwt()->>'is_anonymous') is distinct from 'true'
$$;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.vendeora_role() from public, anon;
grant execute on function public.vendeora_role() to authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(name) on public.profiles to authenticated;
create policy profile_read on public.profiles for select to authenticated using (id = (select auth.uid()) and (select public.vendeora_role()) is not null or (select public.vendeora_role()) = 'admin');
create policy profile_update on public.profiles for update to authenticated using (id = (select auth.uid()) and (select public.vendeora_role()) is not null) with check (id = (select auth.uid()));

create table public.products (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references public.profiles on delete restrict,
  title text not null check (length(trim(title)) between 3 and 120), description text not null default '' check (length(description) <= 3000),
  category text not null check (category in ('Curso online','E-book','PDF','Mentoria','Consultoria','Assinatura','Comunidade','Outros')),
  price_cents integer not null check (price_cents between 500 and 10000000), active boolean not null default false,
  archived boolean not null default false, affiliates_enabled boolean not null default false, created_at timestamptz not null default now()
);
create index products_owner_idx on public.products(owner_id,created_at desc);
alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select, insert on public.products to authenticated;
grant update(title, description, category, price_cents, active, archived, affiliates_enabled) on public.products to authenticated;
create policy product_read on public.products for select to authenticated using (
  owner_id = (select auth.uid()) and (select public.vendeora_role()) = 'producer' or (select public.vendeora_role()) = 'admin'
  or (select public.vendeora_role()) = 'affiliate' and active and not archived and affiliates_enabled
);
create policy product_create on public.products for insert to authenticated with check (owner_id = (select auth.uid()) and (select public.vendeora_role()) = 'producer');
create policy product_update on public.products for update to authenticated using (owner_id = (select auth.uid()) and (select public.vendeora_role()) = 'producer') with check (owner_id = (select auth.uid()));

create table public.orders (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
  seller_id uuid not null references public.profiles, buyer_id uuid not null references public.profiles,
  amount_cents integer not null check (amount_cents > 0), currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null default 'pending' check (status in ('pending','paid','failed','expired','refunded')),
  provider_session text unique, created_at timestamptz not null default now(), paid_at timestamptz
);
create index orders_seller_idx on public.orders(seller_id,created_at desc);
create index orders_buyer_idx on public.orders(buyer_id,created_at desc);
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant select(id, product_id, seller_id, buyer_id, amount_cents, currency, status, created_at, paid_at) on public.orders to authenticated;
create policy order_read on public.orders for select to authenticated using ((select public.vendeora_role()) is not null and ((select auth.uid()) in (seller_id, buyer_id) or (select public.vendeora_role()) = 'admin'));

create table public.affiliate_requests (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
  affiliate_id uuid not null default auth.uid() references public.profiles,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(), unique(product_id, affiliate_id)
);
alter table public.affiliate_requests enable row level security;
revoke all on public.affiliate_requests from anon, authenticated;
grant select, insert(product_id), update(status) on public.affiliate_requests to authenticated;
create policy affiliate_read on public.affiliate_requests for select to authenticated using (
  affiliate_id = (select auth.uid()) and (select public.vendeora_role()) = 'affiliate' or
  (select public.vendeora_role()) = 'producer' and exists(select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
);
create policy affiliate_create on public.affiliate_requests for insert to authenticated with check (
  affiliate_id = (select auth.uid()) and (select public.vendeora_role()) = 'affiliate' and
  exists(select 1 from public.products p where p.id = product_id and p.affiliates_enabled and p.active and not p.archived)
);
create policy affiliate_review on public.affiliate_requests for update to authenticated using (
  (select public.vendeora_role()) = 'producer' and exists(select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
) with check (status in ('approved','declined') and exists(select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())));

create table public.lessons (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
  title text not null check (length(trim(title)) between 3 and 150), content text not null check (length(trim(content)) between 1 and 16000),
  created_at timestamptz not null default now()
);
create index lessons_product_idx on public.lessons(product_id,created_at);
alter table public.lessons enable row level security;
revoke all on public.lessons from anon, authenticated;
grant select, insert, delete, update(title,content) on public.lessons to authenticated;
create policy lesson_owner on public.lessons for all to authenticated using (
  (select public.vendeora_role()) = 'producer' and exists(select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid()))
) with check ((select public.vendeora_role()) = 'producer' and exists(select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())));
create policy lesson_buyer on public.lessons for select to authenticated using (
  (select public.vendeora_role()) is not null and exists (select 1 from public.orders o where o.product_id = lessons.product_id and o.buyer_id = (select auth.uid()) and o.status = 'paid')
);

create table public.lesson_progress (
  user_id uuid not null default auth.uid() references public.profiles, lesson_id uuid not null references public.lessons on delete cascade,
  completed_at timestamptz not null default now(), primary key(user_id,lesson_id)
);
alter table public.lesson_progress enable row level security;
revoke all on public.lesson_progress from anon, authenticated;
grant select, insert(lesson_id), delete on public.lesson_progress to authenticated;
create policy progress_read on public.lesson_progress for select to authenticated using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null);
create policy progress_delete on public.lesson_progress for delete to authenticated using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null);
create policy progress_write on public.lesson_progress for insert to authenticated with check (
  user_id = (select auth.uid()) and (select public.vendeora_role()) is not null and exists (
    select 1 from public.lessons l join public.orders o on o.product_id = l.product_id where l.id = lesson_id and o.buyer_id = (select auth.uid()) and o.status = 'paid'
  )
);

create function public.vendeora_offer(product uuid) returns table(id uuid,title text,description text,category text,price_cents integer)
language sql stable security definer set search_path = '' as $$
  select p.id,p.title,p.description,p.category,p.price_cents from public.products p join public.profiles f on f.id = p.owner_id
  where p.id = product and p.active and not p.archived and f.active and f.role = 'producer'
$$;
revoke all on function public.vendeora_offer(uuid) from public;
grant execute on function public.vendeora_offer(uuid) to anon, authenticated;

create table private.payment_events (provider_event text primary key, received_at timestamptz not null default now());
alter table private.payment_events enable row level security;
grant select,insert,update on public.orders to service_role;
grant select on public.products to service_role;

create function public.vendeora_payment_event(event_id text, session_id text, order_id uuid, next_status text, amount integer, payment_currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if next_status not in ('paid','failed','expired') then return false; end if;
  if not exists(select 1 from public.orders o where o.id=order_id and o.provider_session=session_id and o.amount_cents=amount and lower(o.currency)=payment_currency) then return false; end if;
  insert into private.payment_events(provider_event) values (event_id) on conflict do nothing;
  if not found then return true; end if;
  update public.orders set status=next_status, paid_at=case when next_status='paid' then now() else paid_at end
    where id=order_id and (status='pending' or status='failed' and next_status='paid');
  return true;
end
$$;
revoke all on function public.vendeora_payment_event(text,text,uuid,text,integer,text) from public, anon, authenticated;
grant execute on function public.vendeora_payment_event(text,text,uuid,text,integer,text) to service_role;

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references public.profiles,
  kind text not null check (kind in ('export','correction','deletion')), created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','resolved')), unique(user_id,kind,status)
);
alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from anon, authenticated;
grant select,insert(kind) on public.privacy_requests to authenticated;
create policy privacy_request_read on public.privacy_requests for select to authenticated using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null or (select public.vendeora_role()) = 'admin');
create policy privacy_request_create on public.privacy_requests for insert to authenticated with check (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null);
