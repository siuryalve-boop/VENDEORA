create or replace function private.valid_cpf(cpf text) returns boolean language sql immutable set search_path = '' as $$
  select case when cpf !~ '^[0-9]{11}$' or cpf ~ '^([0-9])\1{10}$' then false else (
    select bool_and(((sum_digits * 10) % 11) % 10 = substring(cpf, position + 1, 1)::integer)
    from (select p as position, sum(substring(cpf, i, 1)::integer * (p + 2 - i)) as sum_digits
      from (values (9), (10)) checks(p) cross join lateral generate_series(1, p) i group by p) sums
  ) end
$$;
