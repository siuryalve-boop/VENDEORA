create table public.order_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  status text not null check (status in ('created','pending','paid','failed','expired','refunded')),
  occurred_at timestamptz not null default now()
);
create index order_history_order_idx on public.order_history(order_id, occurred_at, id);
alter table public.order_history enable row level security;
revoke all on public.order_history from public, anon, authenticated;
grant select on public.order_history to authenticated;
create policy order_history_read on public.order_history for select to authenticated
  using (exists(select 1 from public.orders o where o.id = order_id));

insert into public.order_history(order_id,status,occurred_at)
select id,'created',created_at from public.orders
union all
select id,'paid',paid_at from public.orders where paid_at is not null;

create function private.record_order_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_history(order_id,status,occurred_at) values (new.id,'created',new.created_at);
    if new.status <> 'pending' then
      insert into public.order_history(order_id,status) values (new.id,new.status);
    end if;
  elsif new.status is distinct from old.status then
    insert into public.order_history(order_id,status) values (new.id,new.status);
  end if;
  return new;
end
$$;
revoke all on function private.record_order_history() from public, anon, authenticated;
create trigger order_record_history after insert or update of status on public.orders
  for each row execute function private.record_order_history();

create function public.vendeora_copy_product(source uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare original public.products%rowtype; copy_id uuid := gen_random_uuid();
  original_module record; copy_module uuid;
begin
  if (select public.vendeora_role()) is distinct from 'producer' then raise insufficient_privilege; end if;
  select * into original from public.products where id=source and owner_id=(select auth.uid()) and not archived;
  if not found then return null; end if;
  insert into public.products(id,title,description,category,price_cents,commission_percent,pack_slug)
    values(copy_id,left(original.title,111) || ' (cópia)',original.description,original.category,
      original.price_cents,original.commission_percent,
      case when original.pack_slug is not null then 'pack-' || copy_id::text end);
  insert into public.checkouts(product_id,headline,accent)
    select copy_id,headline,accent from public.checkouts where product_id=source;
  insert into public.pack_files(product_id,filename,content)
    select copy_id,filename,content from public.pack_files where product_id=source;
  for original_module in select id,title,position from public.course_modules where product_id=source loop
    insert into public.course_modules(product_id,title,position)
      values(copy_id,original_module.title,original_module.position) returning id into copy_module;
    insert into public.lessons(product_id,module_id,title,content)
      select copy_id,copy_module,title,content from public.lessons where module_id=original_module.id order by created_at,id;
  end loop;
  insert into public.lessons(product_id,title,content)
    select copy_id,title,content from public.lessons where product_id=source and module_id is null order by created_at,id;
  return copy_id;
end
$$;
revoke all on function public.vendeora_copy_product(uuid) from public, anon;
grant execute on function public.vendeora_copy_product(uuid) to authenticated;
