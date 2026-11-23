begin;

insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','operations-seller@example.invalid','{"cpf":"12345678909","name":"Pessoa Produtora","phone":"11912345678","birth":"1990-01-01","account_role":"producer","terms_version":"2026-11-22"}',now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','operations-buyer@example.invalid','{"cpf":"98765432100","name":"Pessoa Compradora","phone":"11912345678","birth":"1990-01-01","account_role":"student","terms_version":"2026-11-22"}',now()),
('99999999-9999-4999-8999-999999999999','operations-affiliate@example.invalid','{"cpf":"52998224725","name":"Pessoa Afiliada","phone":"11912345678","birth":"1990-01-01","account_role":"affiliate","terms_version":"2026-11-22"}',now());

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.products(id,title,category,price_cents,active) values
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Produto teste operações','Curso online',10000,true),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Outro produto de teste','E-book',10000,true);
insert into public.course_modules(product_id,title,position) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Módulo de teste',1);
insert into public.lessons(product_id,module_id,title,content) select product_id,id,'Aula de teste','Conteúdo de teste'
from public.course_modules where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
  begin
    insert into public.lessons(product_id,module_id,title,content) select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',id,'Aula de teste','Conteúdo de teste'
    from public.course_modules where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    raise exception 'Lesson assigned to a different product';
  exception when foreign_key_violation then null;
  end;
end $$;
select public.vendeora_save_checkout('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Oferta de teste','#d94e0b');
select public.vendeora_save_checkout('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Chamada atualizada','#123456');
insert into public.coupons(product_id,code,percent) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','TESTE20',20);
update public.products set affiliates_enabled=true, commission_percent=15 where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
insert into public.affiliate_requests(product_id) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.affiliate_requests set status='approved' where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
do $$ begin
  if not public.vendeora_referral_click('cccccccc-cccc-4ccc-8ccc-cccccccccccc',(select id from public.affiliate_requests)) then raise exception 'Referral click was not recorded'; end if;
end $$;

reset role;
insert into public.orders(id,product_id,seller_id,buyer_id,amount_cents,referral_id,commission_percent)
select 'ffffffff-ffff-4fff-8fff-ffffffffffff',product_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',8000,id,15
from public.affiliate_requests where product_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update public.orders set status='paid',paid_at=now() where id='ffffffff-ffff-4fff-8fff-ffffffffffff';

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-4999-8999-999999999999';
do $$ begin
  if (select visits from public.affiliate_requests) is distinct from 1::bigint then raise exception 'Referral visit count is wrong'; end if;
  if exists (select 1 from public.vendeora_checkout_referral('cccccccc-cccc-4ccc-8ccc-cccccccccccc',(select id from public.affiliate_requests))) then raise exception 'Affiliate can receive commission on their own checkout'; end if;
  if (select amount_cents from public.commissions) is distinct from 1200 then raise exception 'Affiliate commission calculation failed'; end if;
end $$;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  if (select count(*) from public.vendeora_customers(null)) <> 1 then raise exception 'Producer CRM access failed'; end if;
  if (select sum(gross_cents) from public.vendeora_sales_report(current_date - 1, current_date + 1)) is distinct from 8000::numeric then raise exception 'Report was not based on the order'; end if;
end $$;

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin
  if exists(select 1 from public.vendeora_customers(null)) then raise exception 'Buyer can list producer contacts'; end if;
  if (select count(*) from public.course_modules) <> 1 then raise exception 'Purchased module is unavailable'; end if;
  if exists(select 1 from public.coupons) then raise exception 'Buyer browsed private coupon list'; end if;
  if (select amount_cents from public.vendeora_checkout_quote('cccccccc-cccc-4ccc-8ccc-cccccccccccc','teste20')) is distinct from 8000 then raise exception 'Coupon quote incorrect'; end if;
  if (select count(*) from public.notifications where event='payment_approved') <> 1 then raise exception 'Payment notification missing or leaked'; end if;
  begin
    perform public.vendeora_change_account('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
    raise exception 'Buyer granted account administration';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.support_tickets(subject,message) values ('Chamado de teste','Texto para verificar a criação de chamados.');

reset role;
update public.profiles set role='admin' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claims = '{"aal":"aal1"}';
do $$ begin
  if exists(select 1 from public.support_tickets) then raise exception 'Support administration exposed before MFA'; end if;
  begin
    perform public.vendeora_change_account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
    raise exception 'An unverified admin suspended a user';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"aal":"aal2"}';
do $$ begin
  if (select count(*) from public.support_tickets) <> 1 then raise exception 'MFA administration should have support access'; end if;
  if not public.vendeora_answer_ticket((select id from public.support_tickets),'Resposta de teste',true) then raise exception 'Support reply failed'; end if;
  if not public.vendeora_change_account('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false) then raise exception 'Verified admin could not suspend user'; end if;
end $$;
reset role;
set constraints all immediate;
select 'CRM, relatórios, módulos, cupom, notificações, suporte, MFA, cliques e comissões em teste' as verified;
rollback;
