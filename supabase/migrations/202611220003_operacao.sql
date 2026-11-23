create function public.vendeora_customers(customer uuid default null)
returns table(id uuid, name text, email text, purchase_count bigint, total_cents bigint, first_purchase timestamptz, last_purchase timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.buyer_id, p.name, u.email::text, count(*), sum(o.amount_cents), min(o.paid_at), max(o.paid_at)
  from public.orders o
  join public.profiles p on p.id = o.buyer_id
  join auth.users u on u.id = o.buyer_id
  where (select public.vendeora_role()) = 'producer' and o.seller_id = (select auth.uid())
    and o.status = 'paid' and (customer is null or o.buyer_id = customer)
  group by o.buyer_id, p.name, u.email
  order by max(o.paid_at) desc nulls last, o.buyer_id
  limit 500
$$;
revoke all on function public.vendeora_customers(uuid) from public, anon;
grant execute on function public.vendeora_customers(uuid) to authenticated;

create function public.vendeora_sales_report(from_day date, through_day date)
returns table(day date, approved bigint, pending bigint, declined bigint, refunded bigint, gross_cents bigint, refunded_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select (o.created_at at time zone 'America/Sao_Paulo')::date, count(*) filter (where o.status = 'paid'),
    count(*) filter (where o.status = 'pending'), count(*) filter (where o.status in ('failed','expired')),
    count(*) filter (where o.status = 'refunded'), coalesce(sum(o.amount_cents) filter (where o.status = 'paid'),0),
    coalesce(sum(o.amount_cents) filter (where o.status = 'refunded'),0)
  from public.orders o
  where (select public.vendeora_role()) = 'producer' and o.seller_id = (select auth.uid())
    and through_day - from_day between 0 and 365
    and o.created_at >= (from_day::timestamp at time zone 'America/Sao_Paulo')
    and o.created_at < ((through_day + 1)::timestamp at time zone 'America/Sao_Paulo')
  group by 1 order by 1 desc
$$;
revoke all on function public.vendeora_sales_report(date,date) from public, anon;
grant execute on function public.vendeora_sales_report(date,date) to authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  event text not null check (event in ('payment_approved','payment_failed','affiliate_requested','affiliate_approved','affiliate_declined','support_reply')),
  created_at timestamptz not null default now(), read_at timestamptz,
  target_id uuid not null
);
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
create policy notifications_own_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null);
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null)
  with check (user_id = (select auth.uid()));

create function private.notify_order_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' then
    insert into public.notifications(user_id, event, target_id)
    select distinct recipient, 'payment_approved', new.id from (values (new.buyer_id), (new.seller_id)) people(recipient);
  elsif new.status = 'failed' then
    insert into public.notifications(user_id, event, target_id) values (new.buyer_id, 'payment_failed', new.id);
  end if;
  return new;
end
$$;
revoke all on function private.notify_order_status() from public, anon, authenticated;
create trigger vendeora_order_notification after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function private.notify_order_status();

create function private.notify_affiliate_status() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id,event,target_id)
      select owner_id, 'affiliate_requested', new.id from public.products where id = new.product_id;
  elsif new.status is distinct from old.status then
    insert into public.notifications(user_id,event,target_id)
      values (new.affiliate_id, case when new.status = 'approved' then 'affiliate_approved' else 'affiliate_declined' end, new.id);
  end if;
  return new;
end
$$;
revoke all on function private.notify_affiliate_status() from public, anon, authenticated;
create trigger vendeora_affiliate_notification after insert or update of status on public.affiliate_requests
  for each row execute function private.notify_affiliate_status();

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references public.profiles on delete restrict,
  subject text not null check(length(trim(subject)) between 5 and 120),
  message text not null check(length(trim(message)) between 10 and 5000),
  status text not null default 'open' check(status in ('open','answered','closed')),
  response text check(length(trim(response)) between 5 and 5000),
  created_at timestamptz not null default now(), answered_at timestamptz
);
create index support_user_idx on public.support_tickets(user_id, created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;
grant select, insert(subject,message) on public.support_tickets to authenticated;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null
    or (select public.vendeora_role()) = 'admin' and (select auth.jwt()->>'aal') = 'aal2');
create policy support_tickets_insert on public.support_tickets for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.vendeora_role()) is not null);

create table private.platform_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles,
  action text not null, target_id uuid not null, created_at timestamptz not null default now()
);
alter table private.platform_audit enable row level security;

create function public.vendeora_answer_ticket(ticket uuid, reply text, close_ticket boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare subject_user uuid;
begin
  if (select public.vendeora_role()) is distinct from 'admin' or (select auth.jwt()->>'aal') is distinct from 'aal2' then
    raise insufficient_privilege using message = 'Administrator MFA required';
  end if;
  update public.support_tickets set response = trim(reply), answered_at = now(),
    status = case when close_ticket then 'closed' else 'answered' end
    where id = ticket and status <> 'closed' returning user_id into subject_user;
  if not found then return false; end if;
  insert into public.notifications(user_id,event,target_id) values (subject_user,'support_reply',ticket);
  insert into private.platform_audit(actor_id,action,target_id) values ((select auth.uid()),'support_reply',ticket);
  return true;
end
$$;
revoke all on function public.vendeora_answer_ticket(uuid,text,boolean) from public, anon;
grant execute on function public.vendeora_answer_ticket(uuid,text,boolean) to authenticated;

create table public.course_modules (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
  title text not null check(length(trim(title)) between 3 and 150),
  position integer not null default 1 check(position between 1 and 200),
  created_at timestamptz not null default now(), unique(id, product_id)
);
create index course_modules_product_idx on public.course_modules(product_id, position, created_at);
alter table public.course_modules enable row level security;
revoke all on public.course_modules from anon, authenticated;
grant select, insert(product_id,title,position), update(title,position), delete on public.course_modules to authenticated;
create policy module_owner on public.course_modules for all to authenticated
  using ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())))
  with check ((select public.vendeora_role()) = 'producer' and exists (select 1 from public.products p where p.id = product_id and p.owner_id = (select auth.uid())));
create policy module_buyer on public.course_modules for select to authenticated
  using ((select public.vendeora_role()) is not null and exists (select 1 from public.orders o
    where o.product_id = course_modules.product_id and o.buyer_id = (select auth.uid()) and o.status = 'paid'));

alter table public.lessons add column module_id uuid;
alter table public.lessons add constraint lesson_module_same_product foreign key (module_id, product_id)
  references public.course_modules(id, product_id) on delete set null (module_id);
create index lessons_module_idx on public.lessons(module_id);
grant update(module_id) on public.lessons to authenticated;
