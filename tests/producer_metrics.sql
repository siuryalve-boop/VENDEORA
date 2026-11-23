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
select public.vendeora_create_pack('metrics-fixture','Analytics fixture','',3000,
  '[{"filename":"guide.md","content":"Fixture"}]');
reset role;
insert into public.orders(product_id,seller_id,buyer_id,amount_cents,payment_mode,status,created_at,paid_at)
select p.id,p.owner_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',r.amount,r.mode,r.status,
  now()-r.age,case when r.status='paid' then now()-r.age end
from public.products p cross join (values
  (3000,'test','paid',interval '2 hours'),(2100,'test','paid',interval '35 days'),
  (5000,'test','failed',interval '1 hour'),(9999,'live','paid',interval '1 hour')
) r(amount,mode,status,age) where p.pack_slug='metrics-fixture';
set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ declare v jsonb := public.vendeora_producer_metrics(30);
begin
  if (v->>'current_gross')::integer is distinct from 3000
    or (v->>'previous_gross')::integer is distinct from 2100
    or (v->>'lifetime_cents')::integer is distinct from 5100
    or (v->>'declined')::integer is distinct from 1
    or v#>>'{top_products,0,title}' is distinct from 'Analytics fixture'
  then raise exception 'Invalid comparison, ranking or mode isolation'; end if;
end $$;
set local request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if public.vendeora_producer_metrics(30) is not null then raise exception 'Non-producer received metrics'; end if;
end $$;
reset role;
select 'Producer metrics verified' as result;
rollback;
