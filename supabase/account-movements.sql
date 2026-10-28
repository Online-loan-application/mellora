-- Mellora account movements
-- Run once in Supabase SQL Editor after schema.sql or dashboard-update.sql.
-- Deposits, withdrawals, and admin adjustments update balances and transactions atomically.

create or replace function public.process_account_movement(
  p_account_id uuid,
  p_kind text,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.accounts%rowtype;
  v_amount numeric(14,2) := round(p_amount, 2);
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to move money.';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'withdraw') then
    raise exception 'Choose either deposit or withdraw.';
  end if;

  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;

  select * into v_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This account is not available for your member profile.';
  end if;

  if p_kind = 'withdraw' and v_account.balance < v_amount then
    raise exception 'Insufficient funds for this withdrawal.';
  end if;

  if p_kind = 'deposit' and v_account.balance + v_amount > 999999999999.99 then
    raise exception 'This deposit would exceed the supported account balance.';
  end if;

  update public.accounts
  set balance = balance + case when p_kind = 'deposit' then v_amount else -v_amount end
  where id = v_account.id;

  insert into public.transactions (user_id, account_id, merchant, category, amount, status)
  values (
    auth.uid(),
    v_account.id,
    case when p_kind = 'deposit' then 'Account deposit' else 'Account withdrawal' end,
    case when p_kind = 'deposit' then 'Deposit' else 'Withdrawal' end,
    case when p_kind = 'deposit' then v_amount else -v_amount end,
    'completed'
  );
end;
$$;

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

revoke all on function public.process_account_movement(uuid, text, numeric) from public;
revoke all on function public.admin_set_account_balance(uuid, numeric) from public;
grant execute on function public.process_account_movement(uuid, text, numeric) to authenticated;
grant execute on function public.admin_set_account_balance(uuid, numeric) to authenticated;
