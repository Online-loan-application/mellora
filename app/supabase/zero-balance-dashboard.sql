-- Mellora / zero starting balances and consistent admin-led account activity
-- Run once on an existing Mellora database after the earlier upgrades.
-- This preserves every profile with admin-adjusted balances or non-sample activity.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;

  insert into public.accounts (user_id, name, type, balance, last4)
  values
    (new.id, 'Everyday account', 'checking', 0.00, '2840'),
    (new.id, 'Mellow savings', 'savings', 0.00, '7210');

  return new;
end;
$$;

-- Keep every admin balance update on one signed activity ledger.
-- Positive differences feed Money in; successful withdrawals feed Money out.
create or replace function public.admin_set_account_balance(
  p_account_id uuid,
  p_balance numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.accounts%rowtype;
  v_balance numeric(14,2) := round(p_balance, 2);
  v_difference numeric(14,2);
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;

  if v_balance is null or v_balance < 0 or v_balance > 999999999999.99 then
    raise exception 'Enter a valid account balance.';
  end if;

  select * into v_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'Account not found.';
  end if;

  v_difference := v_balance - v_account.balance;

  update public.accounts
  set balance = v_balance
  where id = v_account.id;

  if v_difference <> 0 then
    insert into public.transactions (user_id, account_id, merchant, category, amount, status)
    values (
      v_account.user_id,
      v_account.id,
      'Admin balance adjustment',
      'Balance adjustment',
      v_difference,
      'completed'
    );
  end if;
end;
$$;

revoke all on function public.admin_set_account_balance(uuid, numeric) from public;
grant execute on function public.admin_set_account_balance(uuid, numeric) to authenticated;

-- Remove only the untouched original sample bundle. Any admin adjustment or any
-- additional/different transaction disqualifies the profile from this cleanup.
create temporary table mellora_original_sample_users (user_id uuid primary key) on commit drop;

insert into mellora_original_sample_users (user_id)
select p.id
from public.profiles p
where (select count(*) from public.accounts a where a.user_id = p.id) = 2
  and exists (
    select 1 from public.accounts a
    where a.user_id = p.id and a.name = 'Everyday account'
      and a.type = 'checking' and a.balance = 12840.62 and a.last4 = '2840'
  )
  and exists (
    select 1 from public.accounts a
    where a.user_id = p.id and a.name = 'Mellow savings'
      and a.type = 'savings' and a.balance = 8240.00 and a.last4 = '7210'
  )
  and (select count(*) from public.transactions t where t.user_id = p.id) = 5
  and not exists (
    select 1 from public.transactions t
    where t.user_id = p.id
      and (t.merchant, t.category, t.amount) not in (
        ('Salary deposit', 'Income', 3200.00),
        ('Corner market', 'Groceries', -24.80),
        ('City transit', 'Transport', -4.25),
        ('Automatic round-up', 'Savings', 18.40),
        ('Studio subscription', 'Software', -12.00)
      )
  );

update public.accounts a
set balance = 0.00
from mellora_original_sample_users s
where a.user_id = s.user_id;

delete from public.transactions t
using mellora_original_sample_users s
where t.user_id = s.user_id;

commit;

notify pgrst, 'reload schema';
