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
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.vendeora_create_pack('pack-teste','Pack de teste','Descrição',2900,
  '[{"filename":"guia.md","content":"Guia privado"},{"filename":"lista.csv","content":"tarefa,status"}]');
do $$ begin
  if (select file_count from public.vendeora_pack_library()) is distinct from 2::bigint then
    raise exception 'Producer pack creation or access failed';
  end if;
  if has_function_privilege('authenticated','public.vendeora_payout_request(uuid,text,uuid,integer,text)','execute') then
    raise exception 'User can operate the payout persistence directly';
  end if;
end $$;

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if exists(select 1 from public.pack_files) or exists(select 1 from public.vendeora_pack_library()) then
    raise exception 'Pack leaked before purchase';
  end if;
end $$;

reset role;
insert into public.orders(id,product_id,seller_id,buyer_id,amount_cents,platform_fee_cents,provider_session)
  select 'ffffffff-ffff-4fff-8fff-ffffffffffff',id,owner_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2900,145,'cs_test_CommerceX'
  from public.products where pack_slug='pack-teste';

do $$
declare payout record;
begin
  if public.vendeora_payment_event_v2('evt_commerce_test','cs_test_CommerceX','ffffffff-ffff-4fff-8fff-ffffffffffff','paid',2900,'brl','live','pi_CommerceX') then
    raise exception 'Wrong environment could finalize a payment';
  end if;
  if not public.vendeora_payment_event_v2('evt_commerce_test','cs_test_CommerceX','ffffffff-ffff-4fff-8fff-ffffffffffff','paid',2900,'brl','test','pi_CommerceX') then
    raise exception 'Valid payment could not be finalized';
  end if;
  perform public.vendeora_connect_binding('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','acct_CommerceX');
  perform public.vendeora_payout_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',500,'po_CommerceX');
  select * into payout from public.vendeora_payout_request('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',800,'po_CommerceY');
  if payout.payout_id is distinct from 'po_CommerceX' or payout.original_amount is distinct from 500 then
    raise exception 'Payout changed on retry';
  end if;
end $$;

set local role authenticated;
do $$ begin
  if (select count(*) from public.pack_files) <> 2 or not exists(select 1 from public.vendeora_pack_library()) then
    raise exception 'Buyer could not access a paid pack';
  end if;
end $$;
reset role;
update private.commerce_settings set payment_mode='live' where singleton;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pack_files) or exists(select 1 from public.vendeora_pack_library()) then
    raise exception 'Test purchase granted live access';
  end if;
end $$;
reset role;
update private.commerce_settings set payment_mode='test' where singleton;
select public.vendeora_refund_event('evt_commerce_refund','pi_CommerceX',2900,2900,'brl','test');
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pack_files) or exists(select 1 from public.vendeora_pack_library()) then
    raise exception 'Refunded purchase retained access';
  end if;
end $$;
reset role;

select 'Packs, payment isolation, refunds and payout idempotency validated' as result;
rollback;
