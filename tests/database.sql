begin;

do $$
declare
  user_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  user_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  user_c uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  data jsonb := '{"cpf":"12345678909","name":"Pessoa Teste","phone":"11912345678","birth":"1990-01-01","account_role":"producer","terms_version":"2026-11-22"}';
  saved_metadata jsonb;
begin
  if not private.valid_cpf('12345678909') or private.valid_cpf('12345678900') or private.valid_cpf('11111111111') then
    raise exception 'CPF validation failed';
  end if;
  insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values (user_a,'vendeora-test-a@example.invalid',data,now());
  insert into auth.users(id,email,raw_user_meta_data) values (user_b,'vendeora-test-b@example.invalid',data || '{"cpf":"98765432100","account_role":"student"}');
  select raw_user_meta_data into saved_metadata from auth.users where id=user_a;
  if saved_metadata ?| array['cpf','phone','birth'] then raise exception 'Sensitive metadata was retained'; end if;
  begin
    insert into auth.users(id,email,raw_user_meta_data) values (user_c,'vendeora-test-c@example.invalid',data);
    raise exception 'Duplicate registration was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into auth.users(id,email,raw_user_meta_data) values (user_c,'vendeora-test-c@example.invalid',data || jsonb_build_object('birth', current_date - interval '17 years'));
    raise exception 'Underage registration was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Invalid registration' then raise; end if;
  end;
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.products(title,category,price_cents,active) values ('Produto de teste','Curso online',9900,true);
do $$ begin
  if public.vendeora_role() <> 'producer' or (select count(*) from public.products where title='Produto de teste') <> 1 then raise exception 'Confirmed producer access failed'; end if;
end $$;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if public.vendeora_role() is not null or exists(select 1 from public.products where title='Produto de teste') then raise exception 'Unconfirmed access was not blocked'; end if;
end $$;
reset role;
update auth.users set email_confirmed_at=now() where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
do $$ begin
  if public.vendeora_role() <> 'student' or exists(select 1 from public.products where title='Produto de teste') then raise exception 'Role isolation failed'; end if;
  begin
    update public.profiles set role='admin' where id=auth.uid();
    raise exception 'Role modification was permitted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set constraints all immediate;

insert into public.lessons (product_id,title,content)
select id,'Aula teste','Conteúdo teste' from public.products where title='Produto de teste';
insert into public.orders (id,product_id,seller_id,buyer_id,amount_cents,provider_session)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',id,owner_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',9900,'cs_test_vendeora'
from public.products where title='Produto de teste';

set local role authenticated;
do $$ begin
  if exists(select 1 from public.lessons where title='Aula teste') then raise exception 'An unpaid order unlocked lessons'; end if;
end $$;
reset role;

do $$ begin
  if public.vendeora_payment_event('event_invalid','cs_test_vendeora','dddddddd-dddd-4ddd-8ddd-dddddddddddd','paid',1,'brl') then
    raise exception 'A mismatched amount was accepted';
  end if;
  if not public.vendeora_payment_event('event_test','cs_test_vendeora','dddddddd-dddd-4ddd-8ddd-dddddddddddd','paid',9900,'brl') then raise exception 'Payment was not recorded'; end if;
  if not public.vendeora_payment_event('event_test','cs_test_vendeora','dddddddd-dddd-4ddd-8ddd-dddddddddddd','paid',9900,'brl') then raise exception 'Payment retry was rejected'; end if;
  if (select count(*) from private.payment_events where provider_event='event_test') <> 1 then raise exception 'Payment idempotency failed'; end if;
end $$;

set local role authenticated;
insert into public.lesson_progress (lesson_id) select id from public.lessons where title='Aula teste';
do $$ begin
  if (select count(*) from public.lesson_progress) <> 1 then raise exception 'Paid lesson access or progress failed'; end if;
end $$;
reset role;
select 'CPF, idade, duplicidade, e-mail confirmado, dados privados, RLS, pedidos e acesso às aulas' as verified;
rollback;
