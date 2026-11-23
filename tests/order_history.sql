begin;



-- Generate synthetic test metadata locally. The negative domain never receives mail.
with fixtures(id, role_name, sequence) as (
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,'producer',1),
         ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,'student',2)
), bases as (
  select *, lpad((sequence * 131 + 757)::text,9,'0') as digits from fixtures
), first_digit as (
  select *, digits || (
    select sum(substring(digits,i,1)::integer * (11-i)) * 10 % 11 % 10
    from generate_series(1,9) i
  )::text as stem from bases
), ids as (
  select *, stem || (
    select sum(substring(stem,i,1)::integer * (12-i)) * 10 % 11 % 10
    from generate_series(1,10) i
  )::text as synthetic_document from first_digit
)
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)
  select id, concat(role_name,'@v-commerce.invalid'),
    jsonb_build_object('cpf',synthetic_document,'name',concat('Fixture ',role_name),
      'phone',concat(39,9,repeat('0',8)), 'birth',date '1990-01-01',
      'account_role',role_name,'terms_version','2026-11-22'), now()
  from ids;

set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.vendeora_create_pack('fixture-copy','Fixture pack','Descrição',2900,'[{"filename":"guia.md","content":"private fixture"}]');
select public.vendeora_save_checkout((select id from public.products where pack_slug='fixture-copy'), 'Chamada de teste','#112233');
insert into public.course_modules(product_id,title) select id,'Fixture module' from public.products where pack_slug='fixture-copy';
insert into public.lessons(product_id,module_id,title,content) select product_id,id,'Fixture lesson','Private content' from public.course_modules where title='Fixture module';
do $$ declare copy uuid;
begin
 copy := public.vendeora_copy_product((select id from public.products where pack_slug='fixture-copy'));
 if copy is null or not exists(select 1 from public.products where id=copy and not active and not affiliates_enabled) then raise exception 'Copy was not created as draft'; end if;
 if not exists(select 1 from public.pack_files where product_id=copy) or not exists(select 1 from public.checkouts where product_id=copy and accent='#112233') or not exists(select 1 from public.lessons where product_id=copy and module_id is not null) then raise exception 'Copy lost related content'; end if;
end $$;
reset role;
insert into public.orders(id,product_id,seller_id,buyer_id,amount_cents)
select 'ffffffff-ffff-4fff-8fff-ffffffffffff',id,owner_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2900 from public.products where pack_slug='fixture-copy';
update public.orders set status='paid',paid_at=now() where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
update public.orders set status='paid' where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
update public.orders set status='refunded' where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
set local role authenticated;
set local request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
 if (select array_agg(status order by id) from public.order_history where order_id='ffffffff-ffff-4fff-8fff-ffffffffffff') is distinct from array['created','paid','refunded'] then raise exception 'History has missing or duplicated status'; end if;
 if has_table_privilege('authenticated','public.order_history','insert,update,delete') then raise exception 'History can be modified directly'; end if;
 begin
  perform public.vendeora_copy_product(gen_random_uuid());
  raise exception 'Buyer could duplicate a product';
 exception when insufficient_privilege then null;
 end;
end $$;
set local request.jwt.claim.sub='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$ begin
 if exists(select 1 from public.order_history where order_id='ffffffff-ffff-4fff-8fff-ffffffffffff') then raise exception 'Order history was exposed'; end if;
end $$;
reset role;
select 'Product drafts and immutable order history verified' as result;

rollback;
