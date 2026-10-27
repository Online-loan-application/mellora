-- Mellora deposit instructions and withdrawal requests
-- Run once in Supabase SQL Editor after schema.sql, dashboard-update.sql,
-- and account-movements.sql (if previously installed).
-- Deposits only display admin-managed instructions. Withdrawals create pending
-- requests and never change balances or completed transactions automatically.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.deposit_settings (
  id text primary key default 'default' check (id = 'default'),
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  routing_number text not null default '',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  reason text not null default '',
  instructions text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.deposit_settings (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.withdrawal_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  account_holder text not null check (char_length(account_holder) between 2 and 120),
  bank_name text not null check (char_length(bank_name) between 2 and 120),
  account_number text not null check (char_length(account_number) between 4 and 34),
  routing_number text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  withdrawal_account_id uuid not null references public.withdrawal_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  account_holder text not null,
  bank_name text not null,
  account_number_last4 text not null,
  serial_code_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists withdrawal_accounts_user_id_idx on public.withdrawal_accounts(user_id);
create index if not exists withdrawal_requests_user_created_idx on public.withdrawal_requests(user_id, created_at desc);

-- Saves a pending withdrawal only. No account balance or transaction is changed.
create or replace function public.submit_withdrawal_request(
  p_account_id uuid,
  p_withdrawal_account_id uuid,
  p_amount numeric,
  p_serial_codes text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account public.accounts%rowtype;
  v_recipient public.withdrawal_accounts%rowtype;
  v_amount numeric(14,2) := round(p_amount, 2);
  v_request_id uuid;
  v_code text;
  v_serial_input text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request a withdrawal.';
  end if;

  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;

  if p_serial_codes is null or array_length(p_serial_codes, 1) <> 4 then
    raise exception 'Enter all four serial codes.';
  end if;

  foreach v_code in array p_serial_codes loop
    if v_code is null or trim(v_code) !~ '^[A-Za-z0-9]{4,12}$' then
      raise exception 'Each serial code must contain 4 to 12 letters or numbers.';
    end if;
  end loop;

  select * into v_account
  from public.accounts
  where id = p_account_id
  for update;

  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;

  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select * into v_recipient
  from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();

  if not found then
    raise exception 'Save your withdrawal account details before continuing.';
  end if;

  -- Only a SHA-256 digest is retained; raw serial codes are never stored.
  v_serial_input := auth.uid()::text || ':' || array_to_string(p_serial_codes, ':');

  insert into public.withdrawal_requests (
    user_id,
    account_id,
    withdrawal_account_id,
    amount,
    account_holder,
    bank_name,
    account_number_last4,
    serial_code_hash
  )
  values (
    auth.uid(),
    v_account.id,
    v_recipient.id,
    v_amount,
    v_recipient.account_holder,
    v_recipient.bank_name,
    right(v_recipient.account_number, 4),
    encode(digest(v_serial_input, 'sha256'), 'hex')
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- Retire the old member RPC so it cannot bypass the new request workflow.
drop function if exists public.process_account_movement(uuid, text, numeric);

revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) from public;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) to authenticated;

alter table public.deposit_settings enable row level security;
alter table public.withdrawal_accounts enable row level security;
alter table public.withdrawal_requests enable row level security;

drop policy if exists "Members read deposit settings" on public.deposit_settings;
create policy "Members read deposit settings" on public.deposit_settings
  for select to authenticated
  using (true);

drop policy if exists "Admins insert deposit settings" on public.deposit_settings;
create policy "Admins insert deposit settings" on public.deposit_settings
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins update deposit settings" on public.deposit_settings;
create policy "Admins update deposit settings" on public.deposit_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Read own withdrawal account" on public.withdrawal_accounts;
create policy "Read own withdrawal account" on public.withdrawal_accounts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Create own withdrawal account" on public.withdrawal_accounts;
create policy "Create own withdrawal account" on public.withdrawal_accounts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Update own withdrawal account" on public.withdrawal_accounts;
create policy "Update own withdrawal account" on public.withdrawal_accounts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Read own or admin withdrawal requests" on public.withdrawal_requests;
create policy "Read own or admin withdrawal requests" on public.withdrawal_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.deposit_settings, public.withdrawal_accounts, public.withdrawal_requests from anon;
revoke all on public.deposit_settings, public.withdrawal_accounts, public.withdrawal_requests from authenticated;
grant select on public.deposit_settings to authenticated;
grant insert, update on public.deposit_settings to authenticated;
grant select, insert, update on public.withdrawal_accounts to authenticated;
grant select on public.withdrawal_requests to authenticated;
