-- Mellora / Supabase schema
-- Run once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Mellora member',
  email text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings')),
  balance numeric(14,2) not null default 0,
  currency text not null default 'USD',
  last4 text not null default '0000',
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  merchant text not null,
  category text not null,
  amount numeric(14,2) not null,
  status text not null default 'completed' check (status in ('pending', 'completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  type text not null default 'admin' check (type in ('admin', 'balance')),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists accounts_user_id_idx on public.accounts(user_id);
create index if not exists transactions_user_id_created_idx on public.transactions(user_id, created_at desc);
create index if not exists notifications_user_id_created_idx on public.notifications(user_id, created_at desc);

-- Security-definer role check avoids recursive profile policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- New users receive zero-balance accounts and an empty transaction ledger.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Alert the account owner whenever an administrator changes a balance.
create or replace function public.notify_balance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message)
  values (
    new.user_id,
    'balance',
    'Balance updated',
    'Your ' || new.name || ' balance is now ' ||
      trim(to_char(new.balance, 'FM999,999,999,990.00')) || ' ' || new.currency || '.'
  );
  return new;
end;
$$;

revoke all on function public.notify_balance_change() from public;

drop trigger if exists account_balance_notification on public.accounts;
create trigger account_balance_notification
  after update of balance on public.accounts
  for each row
  when (old.balance is distinct from new.balance)
  execute procedure public.notify_balance_change();

-- Admin balance changes also create a signed ledger adjustment.
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

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account not found.';
  end if;
  v_difference := v_balance - v_account.balance;

  update public.accounts set balance = v_balance where id = v_account.id;
  if v_difference <> 0 then
    insert into public.transactions (user_id, account_id, merchant, category, amount, status)
    values (v_account.user_id, v_account.id, 'Admin balance adjustment', 'Balance adjustment', v_difference, 'completed');
  end if;
end;
$$;

revoke all on function public.admin_set_account_balance(uuid, numeric) from public;
grant execute on function public.admin_set_account_balance(uuid, numeric) to authenticated;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "Read own profile or admin read all" on public.profiles;
create policy "Read own profile or admin read all" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "Admins update member roles" on public.profiles;
create policy "Admins update member roles" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Read own accounts or admin read all" on public.accounts;
create policy "Read own accounts or admin read all" on public.accounts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins update account balances" on public.accounts;
create policy "Admins update account balances" on public.accounts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Read own transactions or admin read all" on public.transactions;
create policy "Read own transactions or admin read all" on public.transactions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Read own notifications" on public.notifications;
create policy "Read own notifications" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins send member notifications" on public.notifications;
create policy "Admins send member notifications" on public.notifications
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Members mark own notifications read" on public.notifications;
create policy "Members mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.profiles, public.accounts, public.transactions, public.notifications from anon;
grant select on public.profiles, public.accounts, public.transactions, public.notifications to authenticated;
grant insert on public.notifications to authenticated;
grant update (role) on public.profiles to authenticated;
grant update (balance) on public.accounts to authenticated;
grant update (read_at) on public.notifications to authenticated;

create extension if not exists pgcrypto;

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
set search_path = public
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

create table if not exists public.member_deposit_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
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

-- Preserve former shared settings when upgrading, then retire that table.
do $$
begin
  if to_regclass('public.deposit_settings') is not null then
    insert into public.member_deposit_settings (
      user_id, bank_name, account_name, account_number, routing_number,
      amount, reason, instructions, updated_by, updated_at
    )
    select p.id, s.bank_name, s.account_name, s.account_number, s.routing_number,
      s.amount, s.reason, s.instructions, s.updated_by, s.updated_at
    from public.profiles p
    cross join public.deposit_settings s
    where s.id = 'default'
    on conflict (user_id) do nothing;
    drop table public.deposit_settings;
  end if;
end;
$$;

create table if not exists public.member_serial_codes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  amount numeric(14,2) not null check (amount > 0),
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  primary key (user_id, slot)
);

create table if not exists public.member_activities (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'deposit_clicked',
    'withdrawal_started',
    'withdrawal_details_saved',
    'withdrawal_amount_entered',
    'withdrawal_previewed',
    'withdrawal_serial_codes_started',
    'withdrawal_submitted'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists member_activities_user_created_idx
  on public.member_activities(user_id, created_at desc);

-- Members record their own workflow events; the type is restricted server-side.
create or replace function public.record_member_activity(
  p_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record account activity.';
  end if;
  if p_type not in (
    'deposit_clicked', 'withdrawal_started', 'withdrawal_details_saved',
    'withdrawal_amount_entered', 'withdrawal_previewed',
    'withdrawal_serial_codes_started', 'withdrawal_submitted'
  ) then
    raise exception 'Unsupported member activity type.';
  end if;

  insert into public.member_activities (user_id, type, metadata)
  values (auth.uid(), p_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Returns code metadata only. Raw code hashes are never exposed to the browser.
create or replace function public.admin_get_member_serial_codes(p_user_id uuid)
returns table(slot integer, amount numeric, created_at timestamptz, used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.created_at, c.used_at
  from public.member_serial_codes c
  where c.user_id = p_user_id and public.is_admin()
  order by c.slot;
$$;

-- Generates or resets all four codes and their amounts in one operation.
-- Plaintext codes are returned once to the administrator and are not stored.
create or replace function public.admin_reset_member_serial_codes(
  p_user_id uuid,
  p_amounts numeric[]
)
returns table(slot integer, code text, amount numeric)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slot integer;
  v_code text;
  v_amount numeric(14,2);
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.';
  end if;
  if p_amounts is null or array_length(p_amounts, 1) <> 4 then
    raise exception 'Enter an amount for each of the four codes.';
  end if;
  for v_slot in 1..4 loop
    if p_amounts[v_slot] is null or round(p_amounts[v_slot], 2) <= 0
      or round(p_amounts[v_slot], 2) > 999999999999.99 then
      raise exception 'Every code amount must be greater than zero.';
    end if;
  end loop;

  delete from public.member_serial_codes where user_id = p_user_id;

  for v_slot in 1..4 loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    v_amount := round(p_amounts[v_slot], 2);
    insert into public.member_serial_codes (user_id, slot, amount, code_hash)
    values (
      p_user_id,
      v_slot,
      v_amount,
      encode(digest(p_user_id::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex')
    );
    return query select v_slot, v_code, v_amount;
  end loop;
end;
$$;

-- Validates each code against its slot and requires the request amount to equal
-- the combined amount assigned to all four codes. Codes become single-use.
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
  v_code_record public.member_serial_codes%rowtype;
  v_amount numeric(14,2) := round(p_amount, 2);
  v_code_total numeric(14,2) := 0;
  v_request_id uuid;
  v_slot integer;
  v_code text;
  v_code_hash text;
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

  for v_slot in 1..4 loop
    v_code := upper(trim(p_serial_codes[v_slot]));
    if v_code is null or v_code !~ '^[A-Z0-9]{4,12}$' then
      raise exception 'Each serial code must contain 4 to 12 letters or numbers.';
    end if;

    select * into v_code_record
    from public.member_serial_codes
    where user_id = auth.uid() and slot = v_slot and used_at is null;

    if not found then
      raise exception 'Serial code % is unavailable. Ask your administrator for a current code set.', v_slot;
    end if;

    v_code_hash := encode(digest(auth.uid()::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex');
    if v_code_hash <> v_code_record.code_hash then
      raise exception 'Serial code % is incorrect.', v_slot;
    end if;
    v_code_total := v_code_total + v_code_record.amount;
  end loop;

  if v_amount <> v_code_total then
    raise exception 'The withdrawal amount must equal the four code amounts'' combined total of %.', trim(to_char(v_code_total, 'FM999,999,999,990.00'));
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;
  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select * into v_recipient from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();
  if not found then
    raise exception 'Save your withdrawal account details before continuing.';
  end if;

  v_serial_input := auth.uid()::text || ':' || array_to_string(p_serial_codes, ':');
  insert into public.withdrawal_requests (
    user_id, account_id, withdrawal_account_id, amount,
    account_holder, bank_name, account_number_last4, serial_code_hash
  ) values (
    auth.uid(), v_account.id, v_recipient.id, v_amount,
    v_recipient.account_holder, v_recipient.bank_name,
    right(v_recipient.account_number, 4), encode(digest(v_serial_input, 'sha256'), 'hex')
  ) returning id into v_request_id;

  update public.member_serial_codes set used_at = now()
  where user_id = auth.uid() and used_at is null;

  insert into public.member_activities (user_id, type, metadata)
  values (auth.uid(), 'withdrawal_submitted', jsonb_build_object('request_id', v_request_id, 'amount', v_amount));
  return v_request_id;
end;
$$;

revoke all on function public.record_member_activity(text, jsonb) from public;
revoke all on function public.admin_get_member_serial_codes(uuid) from public;
revoke all on function public.admin_reset_member_serial_codes(uuid, numeric[]) from public;
revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) from public;
grant execute on function public.record_member_activity(text, jsonb) to authenticated;
grant execute on function public.admin_get_member_serial_codes(uuid) to authenticated;
grant execute on function public.admin_reset_member_serial_codes(uuid, numeric[]) to authenticated;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) to authenticated;

alter table public.member_deposit_settings enable row level security;
alter table public.member_serial_codes enable row level security;
alter table public.member_activities enable row level security;

drop policy if exists "Read own member deposit settings" on public.member_deposit_settings;
create policy "Read own member deposit settings" on public.member_deposit_settings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Admins insert member deposit settings" on public.member_deposit_settings;
create policy "Admins insert member deposit settings" on public.member_deposit_settings
  for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins update member deposit settings" on public.member_deposit_settings;
create policy "Admins update member deposit settings" on public.member_deposit_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Read own or admin member activities" on public.member_activities;
create policy "Read own or admin member activities" on public.member_activities
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins read member notifications" on public.notifications;
create policy "Admins read member notifications" on public.notifications
  for select to authenticated using (public.is_admin());

revoke all on public.member_deposit_settings, public.member_serial_codes, public.member_activities from anon;
revoke all on public.member_deposit_settings, public.member_serial_codes, public.member_activities from authenticated;
grant select, insert, update on public.member_deposit_settings to authenticated;
grant select on public.member_activities to authenticated;

-- After creating your first user, promote that profile manually:
-- update public.profiles set role = 'admin' where email = 'you@example.com';

-- Sequential verification, automatic fees, and optional deposit account metadata.
-- Mellora sequential serial-code verification and automatic processing fees
-- Run once after member-admin-controls.sql.
-- Fees are calculated automatically as 2.5% of each code amount. Admins do not
-- enter fees or reasons. Fees are informational and do not change the request total.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.member_deposit_settings
  add column if not exists bank_branch text not null default '',
  add column if not exists account_type text not null default '';

alter table public.member_serial_codes
  add column if not exists fee numeric(14,2) not null default 0 check (fee >= 0),
  add column if not exists fee_reason text not null default '';

update public.member_serial_codes
set
  fee = round(amount * 0.025, 2),
  fee_reason = case slot
    when 1 then 'First-stage identity and withdrawal request verification.'
    when 2 then 'Recipient account validation and second-stage security review.'
    when 3 then 'Transaction screening and third-stage withdrawal authorization.'
    when 4 then 'Final processing and withdrawal release authorization.'
    else 'Automated serial-code processing.'
  end
where fee = 0 or fee_reason = '';

alter table public.member_activities
  drop constraint if exists member_activities_type_check;
alter table public.member_activities
  add constraint member_activities_type_check check (type in (
    'deposit_clicked',
    'withdrawal_started',
    'withdrawal_details_saved',
    'withdrawal_amount_entered',
    'withdrawal_previewed',
    'withdrawal_serial_codes_started',
    'withdrawal_serial_code_confirmed',
    'withdrawal_submitted'
  ));

-- Members can read only the amounts, automatic fees, and reasons for their
-- current code set. Code hashes and plaintext codes are never returned.
create or replace function public.member_get_serial_code_requirements()
returns table(slot integer, amount numeric, fee numeric, fee_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.fee, c.fee_reason
  from public.member_serial_codes c
  where c.user_id = auth.uid() and c.used_at is null
  order by c.slot;
$$;

-- Verifies one code at a time and records its confirmation in member activity.
-- The code remains active until the complete withdrawal request is submitted.
create or replace function public.verify_member_serial_code(
  p_slot integer,
  p_code text
)
returns table(slot integer, amount numeric, fee numeric, fee_reason text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code_record public.member_serial_codes%rowtype;
  v_code text := upper(trim(p_code));
  v_code_hash text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to verify a serial code.';
  end if;
  if p_slot is null or p_slot not between 1 and 4 then
    raise exception 'The serial-code position is invalid.';
  end if;
  if v_code is null or v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Enter 4 to 12 letters or numbers for serial code %.', p_slot;
  end if;

  select * into v_code_record
  from public.member_serial_codes
  where user_id = auth.uid() and member_serial_codes.slot = p_slot and used_at is null;

  if not found then
    raise exception 'Serial code % is unavailable. Ask your administrator for a current code set.', p_slot;
  end if;

  v_code_hash := encode(digest(auth.uid()::text || ':' || p_slot::text || ':' || v_code, 'sha256'), 'hex');
  if v_code_hash <> v_code_record.code_hash then
    raise exception 'Serial code % is incorrect. Check the code supplied by your administrator.', p_slot;
  end if;

  insert into public.member_activities (user_id, type, metadata)
  values (
    auth.uid(),
    'withdrawal_serial_code_confirmed',
    jsonb_build_object(
      'slot', p_slot,
      'amount', v_code_record.amount,
      'fee', v_code_record.fee
    )
  );

  return query
    select v_code_record.slot::integer, v_code_record.amount,
      v_code_record.fee, v_code_record.fee_reason;
end;
$$;

-- Return type now includes automatic fee details, so replace the prior functions.
drop function public.admin_get_member_serial_codes(uuid);
drop function public.admin_reset_member_serial_codes(uuid, numeric[]);

create function public.admin_get_member_serial_codes(p_user_id uuid)
returns table(slot integer, amount numeric, fee numeric, fee_reason text, created_at timestamptz, used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.fee, c.fee_reason, c.created_at, c.used_at
  from public.member_serial_codes c
  where c.user_id = p_user_id and public.is_admin()
  order by c.slot;
$$;

create function public.admin_reset_member_serial_codes(
  p_user_id uuid,
  p_amounts numeric[]
)
returns table(slot integer, code text, amount numeric, fee numeric, fee_reason text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slot integer;
  v_code text;
  v_amount numeric(14,2);
  v_fee numeric(14,2);
  v_fee_reason text;
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.';
  end if;
  if p_amounts is null or array_length(p_amounts, 1) <> 4 then
    raise exception 'Enter an amount for each of the four codes.';
  end if;
  for v_slot in 1..4 loop
    if p_amounts[v_slot] is null or round(p_amounts[v_slot], 2) <= 0
      or round(p_amounts[v_slot], 2) > 999999999999.99 then
      raise exception 'Every code amount must be greater than zero.';
    end if;
  end loop;

  delete from public.member_serial_codes where user_id = p_user_id;

  for v_slot in 1..4 loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    v_amount := round(p_amounts[v_slot], 2);
    v_fee := round(v_amount * 0.025, 2);
    v_fee_reason := case v_slot
      when 1 then 'First-stage identity and withdrawal request verification.'
      when 2 then 'Recipient account validation and second-stage security review.'
      when 3 then 'Transaction screening and third-stage withdrawal authorization.'
      when 4 then 'Final processing and withdrawal release authorization.'
    end;
    insert into public.member_serial_codes (
      user_id, slot, amount, code_hash, fee, fee_reason
    ) values (
      p_user_id,
      v_slot,
      v_amount,
      encode(digest(p_user_id::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex'),
      v_fee,
      v_fee_reason
    );
    return query select v_slot, v_code, v_amount, v_fee, v_fee_reason;
  end loop;
end;
$$;

-- Final submission revalidates every code and the exact amount. Successful
-- submission consumes the code set and creates only a pending request.
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
  v_code_record public.member_serial_codes%rowtype;
  v_amount numeric(14,2) := round(p_amount, 2);
  v_code_total numeric(14,2) := 0;
  v_request_id uuid;
  v_slot integer;
  v_code text;
  v_code_hash text;
  v_serial_input text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request a withdrawal.';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;
  if p_serial_codes is null or array_length(p_serial_codes, 1) <> 4 then
    raise exception 'Confirm all four serial codes before submitting.';
  end if;

  for v_slot in 1..4 loop
    v_code := upper(trim(p_serial_codes[v_slot]));
    if v_code is null or v_code !~ '^[A-Z0-9]{4,12}$' then
      raise exception 'Each serial code must contain 4 to 12 letters or numbers.';
    end if;

    select * into v_code_record
    from public.member_serial_codes
    where user_id = auth.uid() and slot = v_slot and used_at is null;

    if not found then
      raise exception 'Serial code % is unavailable. Ask your administrator for a current code set.', v_slot;
    end if;

    v_code_hash := encode(digest(auth.uid()::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex');
    if v_code_hash <> v_code_record.code_hash then
      raise exception 'Serial code % is incorrect.', v_slot;
    end if;
    v_code_total := v_code_total + v_code_record.amount;
  end loop;

  if v_amount <> v_code_total then
    raise exception 'The withdrawal amount must equal the four code amounts'' combined total of %.', trim(to_char(v_code_total, 'FM999,999,999,990.00'));
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;
  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select * into v_recipient from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();
  if not found then
    raise exception 'Save your withdrawal account details before continuing.';
  end if;

  v_serial_input := auth.uid()::text || ':' || array_to_string(p_serial_codes, ':');
  insert into public.withdrawal_requests (
    user_id, account_id, withdrawal_account_id, amount,
    account_holder, bank_name, account_number_last4, serial_code_hash
  ) values (
    auth.uid(), v_account.id, v_recipient.id, v_amount,
    v_recipient.account_holder, v_recipient.bank_name,
    right(v_recipient.account_number, 4), encode(digest(v_serial_input, 'sha256'), 'hex')
  ) returning id into v_request_id;

  update public.member_serial_codes set used_at = now()
  where user_id = auth.uid() and used_at is null;

  insert into public.member_activities (user_id, type, metadata)
  values (auth.uid(), 'withdrawal_submitted', jsonb_build_object('request_id', v_request_id, 'amount', v_amount));
  return v_request_id;
end;
$$;

revoke all on function public.member_get_serial_code_requirements() from public;
revoke all on function public.verify_member_serial_code(integer, text) from public;
revoke all on function public.admin_get_member_serial_codes(uuid) from public;
revoke all on function public.admin_reset_member_serial_codes(uuid, numeric[]) from public;
revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) from public;

grant execute on function public.member_get_serial_code_requirements() to authenticated;
grant execute on function public.verify_member_serial_code(integer, text) to authenticated;
grant execute on function public.admin_get_member_serial_codes(uuid) to authenticated;
grant execute on function public.admin_reset_member_serial_codes(uuid, numeric[]) to authenticated;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric, text[]) to authenticated;

commit;

-- Redefined transfer limits, fee amounts, paid codes, and saved recipients.
-- Mellora redefined transfer and serial-fee workflow
-- Run once after sequential-withdrawal-codes.sql.
-- The admin-entered code amount is the fee. Withdrawal amounts are limited only
-- by the available account balance. Paid code fees authorize final submission.

begin;

create extension if not exists pgcrypto with schema extensions;

-- Replace functions whose return types or parameters change in this revision.
drop function if exists public.member_get_serial_code_requirements();
drop function if exists public.verify_member_serial_code(integer, text);
drop function if exists public.admin_get_member_serial_codes(uuid);
drop function if exists public.admin_reset_member_serial_codes(uuid, numeric[]);
drop function if exists public.submit_withdrawal_request(uuid, uuid, numeric, text[]);

-- Remove the former automatic-fee fields. The amount column is now the fee.
alter table public.member_serial_codes
  drop column if exists fee,
  drop column if exists fee_reason;

alter table public.member_serial_codes
  add column if not exists code_name text not null default '',
  add column if not exists code_purpose text not null default '',
  add column if not exists paid_at timestamptz;

update public.member_serial_codes
set
  code_name = case slot
    when 1 then 'Identity Verification'
    when 2 then 'Recipient Confirmation'
    when 3 then 'Security Authorization'
    when 4 then 'Transfer Release'
  end,
  code_purpose = case slot
    when 1 then 'Confirms that you authorize this transfer from your own account.'
    when 2 then 'Confirms that the saved recipient details are correct and approved by you.'
    when 3 then 'Adds a security check before the transfer can be prepared for review.'
    when 4 then 'Confirms final approval to submit the transfer for administrative processing.'
  end
where code_name = '' or code_purpose = '';

-- A member can save multiple recipient accounts and choose one before transferring.
alter table public.withdrawal_accounts
  drop constraint if exists withdrawal_accounts_user_id_key;

create index if not exists withdrawal_accounts_user_created_idx
  on public.withdrawal_accounts(user_id, created_at desc);

-- Returns only the current member's fee amounts, code names, purposes, and paid
-- status. Plaintext codes and code hashes are never exposed.
create function public.member_get_serial_code_requirements()
returns table(
  slot integer,
  amount numeric,
  code_name text,
  code_purpose text,
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.code_name, c.code_purpose, c.paid_at
  from public.member_serial_codes c
  where c.user_id = auth.uid() and c.used_at is null
  order by c.slot;
$$;

-- Verifies codes in sequence. A matching code marks its amount as paid and
-- records the confirmation. Reconfirming an already-paid code is idempotent.
create function public.verify_member_serial_code(
  p_slot integer,
  p_code text
)
returns table(
  slot integer,
  amount numeric,
  code_name text,
  code_purpose text,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code_record public.member_serial_codes%rowtype;
  v_code text := upper(trim(p_code));
  v_code_hash text;
  v_paid_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to verify a serial code.';
  end if;
  if p_slot is null or p_slot not between 1 and 4 then
    raise exception 'The serial-code position is invalid.';
  end if;
  if v_code is null or v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Enter 4 to 12 letters or numbers for serial code %.', p_slot;
  end if;
  if exists (
    select 1 from public.member_serial_codes
    where user_id = auth.uid() and member_serial_codes.slot < p_slot and used_at is null and member_serial_codes.paid_at is null
  ) then
    raise exception 'Confirm the previous serial code before continuing.';
  end if;

  select * into v_code_record
  from public.member_serial_codes
  where user_id = auth.uid() and member_serial_codes.slot = p_slot and used_at is null;

  if not found then
    raise exception 'Serial code % is unavailable. Ask your administrator for a current code set.', p_slot;
  end if;

  v_code_hash := encode(digest(auth.uid()::text || ':' || p_slot::text || ':' || v_code, 'sha256'), 'hex');
  if v_code_hash <> v_code_record.code_hash then
    raise exception 'Serial code % is incorrect. Check the code supplied by your administrator.', p_slot;
  end if;

  if v_code_record.paid_at is null then
    v_paid_at := now();
    update public.member_serial_codes
    set paid_at = v_paid_at
    where user_id = auth.uid() and member_serial_codes.slot = p_slot and used_at is null;

    insert into public.member_activities (user_id, type, metadata)
    values (
      auth.uid(),
      'withdrawal_serial_code_confirmed',
      jsonb_build_object(
        'slot', p_slot,
        'amount', v_code_record.amount,
        'code_name', v_code_record.code_name,
        'paid', true
      )
    );
  else
    v_paid_at := v_code_record.paid_at;
  end if;

  return query
    select v_code_record.slot::integer, v_code_record.amount,
      v_code_record.code_name, v_code_record.code_purpose, v_paid_at;
end;
$$;

create function public.admin_get_member_serial_codes(p_user_id uuid)
returns table(
  slot integer,
  amount numeric,
  code_name text,
  code_purpose text,
  created_at timestamptz,
  paid_at timestamptz,
  used_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.code_name, c.code_purpose,
    c.created_at, c.paid_at, c.used_at
  from public.member_serial_codes c
  where c.user_id = p_user_id and public.is_admin()
  order by c.slot;
$$;

create function public.admin_reset_member_serial_codes(
  p_user_id uuid,
  p_amounts numeric[]
)
returns table(slot integer, code text, amount numeric, code_name text, code_purpose text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slot integer;
  v_code text;
  v_amount numeric(14,2);
  v_code_name text;
  v_code_purpose text;
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.';
  end if;
  if p_amounts is null or array_length(p_amounts, 1) <> 4 then
    raise exception 'Enter a fee amount for each of the four codes.';
  end if;
  for v_slot in 1..4 loop
    if p_amounts[v_slot] is null or round(p_amounts[v_slot], 2) <= 0
      or round(p_amounts[v_slot], 2) > 999999999999.99 then
      raise exception 'Every code fee must be greater than zero.';
    end if;
  end loop;

  delete from public.member_serial_codes where user_id = p_user_id;

  for v_slot in 1..4 loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    v_amount := round(p_amounts[v_slot], 2);
    v_code_name := case v_slot
      when 1 then 'Identity Verification'
      when 2 then 'Recipient Confirmation'
      when 3 then 'Security Authorization'
      when 4 then 'Transfer Release'
    end;
    v_code_purpose := case v_slot
      when 1 then 'Confirms that you authorize this transfer from your own account.'
      when 2 then 'Confirms that the saved recipient details are correct and approved by you.'
      when 3 then 'Adds a security check before the transfer can be prepared for review.'
      when 4 then 'Confirms final approval to submit the transfer for administrative processing.'
    end;
    insert into public.member_serial_codes (
      user_id, slot, amount, code_hash, code_name, code_purpose
    ) values (
      p_user_id,
      v_slot,
      v_amount,
      encode(digest(p_user_id::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex'),
      v_code_name,
      v_code_purpose
    );
    return query select v_slot, v_code, v_amount, v_code_name, v_code_purpose;
  end loop;
end;
$$;

-- Final submission requires all four fees to be paid. Raw codes do not need to
-- be submitted again, so a member can leave and resume an unfinished code set.
create function public.submit_withdrawal_request(
  p_account_id uuid,
  p_withdrawal_account_id uuid,
  p_amount numeric
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
  v_paid_count integer;
  v_serial_input text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request a transfer.';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;

  select count(*) into v_paid_count
  from public.member_serial_codes
  where user_id = auth.uid() and used_at is null and paid_at is not null;
  if v_paid_count <> 4 then
    raise exception 'Confirm and mark all four code fees as paid before submitting the transfer.';
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;
  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select * into v_recipient from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();
  if not found then
    raise exception 'Choose a saved recipient account before continuing.';
  end if;

  select string_agg(code_hash, ':' order by slot) into v_serial_input
  from public.member_serial_codes
  where user_id = auth.uid() and used_at is null and paid_at is not null;

  insert into public.withdrawal_requests (
    user_id, account_id, withdrawal_account_id, amount,
    account_holder, bank_name, account_number_last4, serial_code_hash
  ) values (
    auth.uid(), v_account.id, v_recipient.id, v_amount,
    v_recipient.account_holder, v_recipient.bank_name,
    right(v_recipient.account_number, 4), encode(digest(v_serial_input, 'sha256'), 'hex')
  ) returning id into v_request_id;

  update public.member_serial_codes set used_at = now()
  where user_id = auth.uid() and used_at is null;

  insert into public.member_activities (user_id, type, metadata)
  values (auth.uid(), 'withdrawal_submitted', jsonb_build_object('request_id', v_request_id, 'amount', v_amount));
  return v_request_id;
end;
$$;

revoke all on function public.member_get_serial_code_requirements() from public;
revoke all on function public.verify_member_serial_code(integer, text) from public;
revoke all on function public.admin_get_member_serial_codes(uuid) from public;
revoke all on function public.admin_reset_member_serial_codes(uuid, numeric[]) from public;
revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric) from public;

grant execute on function public.member_get_serial_code_requirements() to authenticated;
grant execute on function public.verify_member_serial_code(integer, text) to authenticated;
grant execute on function public.admin_get_member_serial_codes(uuid) to authenticated;
grant execute on function public.admin_reset_member_serial_codes(uuid, numeric[]) to authenticated;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric) to authenticated;

commit;

-- Persistent admin-readable member serial codes.
-- Mellora / persistent admin-readable member serial codes
-- Run once after redefined-transfer-codes.sql.
-- Newly generated codes are saved with their member and can be fetched again by
-- an administrator. Existing hash-only codes cannot be recovered; reset them once.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.member_serial_codes
  add column if not exists code_value text;

-- The return type changes, so replace the previous function explicitly.
drop function if exists public.admin_get_member_serial_codes(uuid);

create function public.admin_get_member_serial_codes(p_user_id uuid)
returns table(
  slot integer,
  code text,
  amount numeric,
  code_name text,
  code_purpose text,
  created_at timestamptz,
  paid_at timestamptz,
  used_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.code_value, c.amount, c.code_name, c.code_purpose,
    c.created_at, c.paid_at, c.used_at
  from public.member_serial_codes c
  where c.user_id = p_user_id and public.is_admin()
  order by c.slot;
$$;

create or replace function public.admin_reset_member_serial_codes(
  p_user_id uuid,
  p_amounts numeric[]
)
returns table(slot integer, code text, amount numeric, code_name text, code_purpose text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slot integer;
  v_code text;
  v_amount numeric(14,2);
  v_code_name text;
  v_code_purpose text;
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.';
  end if;
  if p_amounts is null or array_length(p_amounts, 1) <> 4 then
    raise exception 'Enter a fee amount for each of the four codes.';
  end if;
  for v_slot in 1..4 loop
    if p_amounts[v_slot] is null or round(p_amounts[v_slot], 2) <= 0
      or round(p_amounts[v_slot], 2) > 999999999999.99 then
      raise exception 'Every code fee must be greater than zero.';
    end if;
  end loop;

  delete from public.member_serial_codes where user_id = p_user_id;

  for v_slot in 1..4 loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    v_amount := round(p_amounts[v_slot], 2);
    v_code_name := case v_slot
      when 1 then 'Identity Verification'
      when 2 then 'Recipient Confirmation'
      when 3 then 'Security Authorization'
      when 4 then 'Transfer Release'
    end;
    v_code_purpose := case v_slot
      when 1 then 'Confirms that you authorize this transfer from your own account.'
      when 2 then 'Confirms that the saved recipient details are correct and approved by you.'
      when 3 then 'Adds a security check before the transfer can be prepared for review.'
      when 4 then 'Confirms final approval to submit the transfer for administrative processing.'
    end;
    insert into public.member_serial_codes (
      user_id, slot, amount, code_hash, code_value, code_name, code_purpose
    ) values (
      p_user_id,
      v_slot,
      v_amount,
      encode(digest(p_user_id::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex'),
      v_code,
      v_code_name,
      v_code_purpose
    );
    return query select v_slot, v_code, v_amount, v_code_name, v_code_purpose;
  end loop;
end;
$$;

revoke all on function public.admin_get_member_serial_codes(uuid) from public;
revoke all on function public.admin_reset_member_serial_codes(uuid, numeric[]) from public;
grant execute on function public.admin_get_member_serial_codes(uuid) to authenticated;
grant execute on function public.admin_reset_member_serial_codes(uuid, numeric[]) to authenticated;

-- Direct table access remains unavailable to browser roles. Codes are returned
-- only by the admin-checked function above; member functions never return them.
revoke all on public.member_serial_codes from anon;
revoke all on public.member_serial_codes from authenticated;

commit;

notify pgrst, 'reload schema';

-- Multiple saved withdrawal methods for fresh installations.
alter table public.withdrawal_accounts
  add column if not exists method text not null default 'bank',
  add column if not exists network text not null default '';

alter table public.withdrawal_accounts
  drop constraint if exists withdrawal_accounts_method_check,
  drop constraint if exists withdrawal_accounts_network_check,
  drop constraint if exists withdrawal_accounts_account_number_check;

alter table public.withdrawal_accounts
  add constraint withdrawal_accounts_method_check
    check (method in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo')),
  add constraint withdrawal_accounts_network_check
    check (
      (method = 'usdt' and network in ('TRC20', 'ERC20', 'BEP20'))
      or (method <> 'usdt' and network = '')
    ),
  add constraint withdrawal_accounts_account_number_check
    check (char_length(account_number) between 4 and 128);

create index if not exists withdrawal_accounts_user_method_created_idx
  on public.withdrawal_accounts(user_id, method, created_at desc);

alter table public.withdrawal_requests
  add column if not exists transfer_method text not null default 'bank',
  add column if not exists network text not null default '';

alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_transfer_method_check,
  drop constraint if exists withdrawal_requests_network_check;

alter table public.withdrawal_requests
  add constraint withdrawal_requests_transfer_method_check
    check (transfer_method in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo')),
  add constraint withdrawal_requests_network_check
    check (
      (transfer_method = 'usdt' and network in ('TRC20', 'ERC20', 'BEP20'))
      or (transfer_method <> 'usdt' and network = '')
    );

create or replace function public.submit_withdrawal_request(
  p_account_id uuid,
  p_withdrawal_account_id uuid,
  p_amount numeric
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
  v_paid_count integer;
  v_serial_input text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request a transfer.';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;

  select count(*) into v_paid_count
  from public.member_serial_codes
  where user_id = auth.uid() and used_at is null and paid_at is not null;
  if v_paid_count <> 4 then
    raise exception 'Confirm and mark all four code fees as paid before submitting the transfer.';
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;
  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select * into v_recipient from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();
  if not found then
    raise exception 'Choose saved transfer details before continuing.';
  end if;

  select string_agg(code_hash, ':' order by slot) into v_serial_input
  from public.member_serial_codes
  where user_id = auth.uid() and used_at is null and paid_at is not null;

  insert into public.withdrawal_requests (
    user_id, account_id, withdrawal_account_id, amount,
    account_holder, bank_name, account_number_last4, serial_code_hash,
    transfer_method, network
  ) values (
    auth.uid(), v_account.id, v_recipient.id, v_amount,
    v_recipient.account_holder, v_recipient.bank_name,
    right(v_recipient.account_number, 4), encode(digest(v_serial_input, 'sha256'), 'hex'),
    v_recipient.method, v_recipient.network
  ) returning id into v_request_id;

  update public.member_serial_codes set used_at = now()
  where user_id = auth.uid() and used_at is null;

  insert into public.member_activities (user_id, type, metadata)
  values (
    auth.uid(),
    'withdrawal_submitted',
    jsonb_build_object(
      'request_id', v_request_id,
      'amount', v_amount,
      'method', v_recipient.method,
      'network', v_recipient.network
    )
  );
  return v_request_id;
end;
$$;

revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric) from public;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';

-- Independent resumable transfer drafts for fresh installations.
create table if not exists public.member_transfer_drafts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo')),
  withdrawal_account_id uuid not null references public.withdrawal_accounts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  serial_step integer not null default 0 check (serial_step between 0 and 3),
  confirmed_codes boolean[] not null default '{false,false,false,false}',
  next_code_available_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, method),
  constraint member_transfer_drafts_four_confirmations
    check (cardinality(confirmed_codes) = 4)
);

alter table public.member_transfer_drafts enable row level security;

drop policy if exists "Members read own transfer drafts" on public.member_transfer_drafts;
create policy "Members read own transfer drafts" on public.member_transfer_drafts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Members create own transfer drafts" on public.member_transfer_drafts;
create policy "Members create own transfer drafts" on public.member_transfer_drafts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Members update own transfer drafts" on public.member_transfer_drafts;
create policy "Members update own transfer drafts" on public.member_transfer_drafts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Members delete own transfer drafts" on public.member_transfer_drafts;
create policy "Members delete own transfer drafts" on public.member_transfer_drafts
  for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.member_transfer_drafts from anon;
revoke all on public.member_transfer_drafts from authenticated;
grant select, insert, update, delete on public.member_transfer_drafts to authenticated;

notify pgrst, 'reload schema';


-- Transfer-status activity and member notifications for fresh installations.
-- Mellora / transfer-status activity and member notifications
-- Run once after persistent-code-countdown.sql.
-- Every allowed member activity is retained and creates one member notification.

begin;

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('admin', 'balance', 'activity', 'transfer'));

alter table public.member_activities
  drop constraint if exists member_activities_type_check;
alter table public.member_activities
  add constraint member_activities_type_check check (type in (
    'deposit_clicked',
    'withdrawal_started',
    'withdrawal_method_selected',
    'withdrawal_details_saved',
    'withdrawal_amount_entered',
    'withdrawal_previewed',
    'withdrawal_serial_codes_started',
    'withdrawal_serial_code_confirmed',
    'withdrawal_draft_resumed',
    'withdrawal_submitted',
    'transfer_processing',
    'transfer_pending'
  ));

create or replace function public.record_member_activity(
  p_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record account activity.';
  end if;
  if p_type not in (
    'deposit_clicked', 'withdrawal_started', 'withdrawal_method_selected',
    'withdrawal_details_saved', 'withdrawal_amount_entered', 'withdrawal_previewed',
    'withdrawal_serial_codes_started', 'withdrawal_serial_code_confirmed',
    'withdrawal_draft_resumed', 'withdrawal_submitted',
    'transfer_processing', 'transfer_pending'
  ) then
    raise exception 'Unsupported member activity type.';
  end if;

  insert into public.member_activities (user_id, type, metadata)
  values (auth.uid(), p_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.record_member_activity(text, jsonb) from public;
grant execute on function public.record_member_activity(text, jsonb) to authenticated;

create or replace function public.notify_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_message text;
  v_notification_type text := 'activity';
  v_amount text := nullif(new.metadata ->> 'amount', '');
  v_method text := case new.metadata ->> 'method'
    when 'bank' then 'Bank transfer'
    when 'paypal' then 'PayPal'
    when 'usdt' then 'USDT'
    when 'cash_app' then 'Cash App'
    when 'wise' then 'Wise'
    when 'venmo' then 'Venmo'
    else 'Transfer'
  end;
begin
  case new.type
    when 'deposit_clicked' then
      v_title := 'Deposit instructions opened';
      v_message := 'You opened your administrator-provided deposit instructions.';
    when 'withdrawal_started' then
      v_title := 'Transfer started';
      v_message := 'You started a new transfer from your dashboard.';
    when 'withdrawal_method_selected' then
      v_title := 'Transfer method selected';
      v_message := v_method || ' was selected for your transfer.';
    when 'withdrawal_details_saved' then
      v_title := 'Transfer details saved';
      v_message := 'Your ' || v_method || ' recipient details were saved.';
    when 'withdrawal_amount_entered' then
      v_title := 'Transfer amount added';
      v_message := 'A transfer amount of $' || coalesce(v_amount, '0.00') || ' was added.';
    when 'withdrawal_previewed' then
      v_title := 'Transfer previewed';
      v_message := 'You reviewed your transfer details and amount.';
    when 'withdrawal_serial_codes_started' then
      v_title := 'Transfer authorization started';
      v_message := 'Your transfer authorization is now in progress.';
    when 'withdrawal_serial_code_confirmed' then
      v_title := 'Authorization confirmed';
      v_message := 'A transfer authorization was confirmed successfully.';
    when 'withdrawal_draft_resumed' then
      v_title := 'Transfer resumed';
      v_message := 'You reopened your saved ' || v_method || ' progress.';
    when 'transfer_processing' then
      v_notification_type := 'transfer';
      v_title := 'Transfer processing';
      v_message := v_method || ' amount of $' || coalesce(v_amount, '0.00') || ' was added to Processing transfers.';
    when 'transfer_pending' then
      v_notification_type := 'transfer';
      v_title := 'Transfer pending';
      v_message := v_method || ' amount of $' || coalesce(v_amount, '0.00') || ' moved to Pending transfers.';
    when 'withdrawal_submitted' then
      v_notification_type := 'transfer';
      v_title := 'Transfer request pending';
      v_message := v_method || ' request for $' || coalesce(v_amount, '0.00') || ' is pending review.';
    else
      v_title := 'Account activity';
      v_message := 'A new ' || replace(new.type, '_', ' ') || ' event was recorded on your Mellora profile.';
  end case;

  insert into public.notifications (user_id, type, title, message)
  values (new.user_id, v_notification_type, v_title, v_message);
  return new;
end;
$$;

revoke all on function public.notify_member_activity() from public;

drop trigger if exists member_activity_notification on public.member_activities;
create trigger member_activity_notification
  after insert on public.member_activities
  for each row execute procedure public.notify_member_activity();

commit;

notify pgrst, 'reload schema';

-- Mellora / independent authorization codes for each previewed transfer method
-- Run once after member-transfer-status-notifications.sql.
-- Existing member-wide code sets are preserved as Bank transfer code sets.

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.member_serial_codes
  add column if not exists method text not null default 'bank';

alter table public.member_serial_codes
  drop constraint if exists member_serial_codes_method_check;
alter table public.member_serial_codes
  add constraint member_serial_codes_method_check
    check (method in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo'));

alter table public.member_serial_codes
  drop constraint if exists member_serial_codes_pkey;
alter table public.member_serial_codes
  add primary key (user_id, method, slot);

alter table public.member_transfer_drafts
  add column if not exists authorization_started_at timestamptz;

-- A preview creates a draft, but only authorization entry makes it Processing.
-- Administrators can discover only methods for which a member has a saved draft.
drop policy if exists "Administrators read member transfer drafts" on public.member_transfer_drafts;
create policy "Administrators read member transfer drafts" on public.member_transfer_drafts
  for select to authenticated
  using (public.is_admin());

-- Replace both the former member-wide functions and this migration's signatures
-- so a changed return type never causes PostgreSQL error 42P13.
drop function if exists public.member_get_serial_code_requirements();
drop function if exists public.member_get_serial_code_requirements(text);
drop function if exists public.verify_member_serial_code(integer, text);
drop function if exists public.verify_member_serial_code(text, integer, text);
drop function if exists public.admin_get_member_serial_codes(uuid);
drop function if exists public.admin_get_member_serial_codes(uuid, text);
drop function if exists public.admin_reset_member_serial_codes(uuid, numeric[]);
drop function if exists public.admin_reset_member_serial_codes(uuid, text, numeric[]);

create function public.member_get_serial_code_requirements(p_method text)
returns table(
  slot integer,
  amount numeric,
  code_name text,
  code_purpose text,
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.amount, c.code_name, c.code_purpose, c.paid_at
  from public.member_serial_codes c
  where c.user_id = auth.uid()
    and c.method = p_method
    and c.used_at is null
  order by c.slot;
$$;

create function public.verify_member_serial_code(
  p_method text,
  p_slot integer,
  p_code text
)
returns table(
  slot integer,
  amount numeric,
  code_name text,
  code_purpose text,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code_record public.member_serial_codes%rowtype;
  v_code text := upper(trim(p_code));
  v_code_hash text;
  v_paid_at timestamptz;
  v_previous_paid integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to verify an authorization code.';
  end if;
  if p_method is null or p_method not in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo') then
    raise exception 'The transfer method is invalid.';
  end if;
  if p_slot is null or p_slot not between 1 and 4 then
    raise exception 'The authorization position is invalid.';
  end if;
  if v_code is null or v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Enter 4 to 12 letters or numbers for this authorization code.';
  end if;

  select count(*) into v_previous_paid
  from public.member_serial_codes c
  where c.user_id = auth.uid()
    and c.method = p_method
    and c.slot < p_slot
    and c.used_at is null
    and c.paid_at is not null;
  if v_previous_paid <> p_slot - 1 then
    raise exception 'Confirm the previous authorization before continuing.';
  end if;

  select * into v_code_record
  from public.member_serial_codes c
  where c.user_id = auth.uid()
    and c.method = p_method
    and c.slot = p_slot
    and c.used_at is null
  for update;

  if not found then
    raise exception 'This authorization is unavailable. Ask your administrator for a current code set.';
  end if;

  -- Keep the established hash format so existing Bank transfer codes remain valid.
  v_code_hash := encode(digest(auth.uid()::text || ':' || p_slot::text || ':' || v_code, 'sha256'), 'hex');
  if v_code_hash <> v_code_record.code_hash then
    raise exception 'The authorization code is incorrect. Check the code supplied by your administrator.';
  end if;

  if v_code_record.paid_at is null then
    v_paid_at := now();
    update public.member_serial_codes c
    set paid_at = v_paid_at
    where c.user_id = auth.uid()
      and c.method = p_method
      and c.slot = p_slot
      and c.used_at is null;

    insert into public.member_activities (user_id, type, metadata)
    values (
      auth.uid(),
      'withdrawal_serial_code_confirmed',
      jsonb_build_object(
        'method', p_method,
        'slot', p_slot,
        'amount', v_code_record.amount,
        'code_name', v_code_record.code_name,
        'paid', true
      )
    );
  else
    v_paid_at := v_code_record.paid_at;
  end if;

  return query
    select v_code_record.slot::integer, v_code_record.amount,
      v_code_record.code_name, v_code_record.code_purpose, v_paid_at;
end;
$$;

create function public.admin_get_member_serial_codes(
  p_user_id uuid,
  p_method text
)
returns table(
  slot integer,
  code text,
  amount numeric,
  code_name text,
  code_purpose text,
  created_at timestamptz,
  paid_at timestamptz,
  used_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.slot::integer, c.code_value, c.amount, c.code_name, c.code_purpose,
    c.created_at, c.paid_at, c.used_at
  from public.member_serial_codes c
  where c.user_id = p_user_id
    and c.method = p_method
    and public.is_admin()
  order by c.slot;
$$;

create function public.admin_reset_member_serial_codes(
  p_user_id uuid,
  p_method text,
  p_amounts numeric[]
)
returns table(slot integer, code text, amount numeric, code_name text, code_purpose text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_slot integer;
  v_code text;
  v_amount numeric(14,2);
  v_code_name text;
  v_code_purpose text;
begin
  if not public.is_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if p_method is null or p_method not in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo') then
    raise exception 'The transfer method is invalid.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.';
  end if;
  if not exists (
    select 1 from public.member_transfer_drafts
    where user_id = p_user_id and method = p_method
  ) then
    raise exception 'This transfer method has not been previewed by the member.';
  end if;
  if p_amounts is null or array_length(p_amounts, 1) <> 4 then
    raise exception 'Enter a fee amount for each of the four authorizations.';
  end if;
  for v_slot in 1..4 loop
    if p_amounts[v_slot] is null or round(p_amounts[v_slot], 2) <= 0
      or round(p_amounts[v_slot], 2) > 999999999999.99 then
      raise exception 'Every authorization fee must be greater than zero.';
    end if;
  end loop;

  delete from public.member_serial_codes
  where user_id = p_user_id and method = p_method;

  for v_slot in 1..4 loop
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 12));
    v_amount := round(p_amounts[v_slot], 2);
    v_code_name := case v_slot
      when 1 then 'Identity Verification'
      when 2 then 'Recipient Confirmation'
      when 3 then 'Security Authorization'
      when 4 then 'Transfer Release'
    end;
    v_code_purpose := case v_slot
      when 1 then 'Confirms that you authorize this transfer from your own account.'
      when 2 then 'Confirms that the saved recipient details are correct and approved by you.'
      when 3 then 'Adds a security check before the transfer can be prepared for review.'
      when 4 then 'Confirms final approval to submit the transfer for administrative processing.'
    end;
    insert into public.member_serial_codes (
      user_id, method, slot, amount, code_hash, code_value, code_name, code_purpose
    ) values (
      p_user_id,
      p_method,
      v_slot,
      v_amount,
      encode(digest(p_user_id::text || ':' || v_slot::text || ':' || v_code, 'sha256'), 'hex'),
      v_code,
      v_code_name,
      v_code_purpose
    );
    return query select v_slot, v_code, v_amount, v_code_name, v_code_purpose;
  end loop;

  -- Reset only this method. Other recipients, fees, paid states, and countdowns
  -- remain untouched. Preserve authorization_started_at so an in-progress draft
  -- returns to Processing and reopens at the first unpaid authorization.
  update public.member_transfer_drafts
  set
    serial_step = 0,
    confirmed_codes = '{false,false,false,false}'::boolean[],
    next_code_available_at = null,
    updated_at = now()
  where user_id = p_user_id and method = p_method;
end;
$$;

create or replace function public.submit_withdrawal_request(
  p_account_id uuid,
  p_withdrawal_account_id uuid,
  p_amount numeric
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
  v_paid_count integer;
  v_serial_input text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request a transfer.';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Enter a valid amount greater than zero.';
  end if;

  select * into v_recipient from public.withdrawal_accounts
  where id = p_withdrawal_account_id and user_id = auth.uid();
  if not found then
    raise exception 'Choose saved transfer details before continuing.';
  end if;

  select count(*) into v_paid_count
  from public.member_serial_codes c
  where c.user_id = auth.uid()
    and c.method = v_recipient.method
    and c.used_at is null
    and c.paid_at is not null;
  if v_paid_count <> 4 then
    raise exception 'Confirm and mark all four authorization fees as paid before submitting the transfer.';
  end if;

  select * into v_account from public.accounts where id = p_account_id for update;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'This funding account is not available for your member profile.';
  end if;
  if v_account.balance < v_amount then
    raise exception 'This request exceeds the available account balance.';
  end if;

  select string_agg(c.code_hash, ':' order by c.slot) into v_serial_input
  from public.member_serial_codes c
  where c.user_id = auth.uid()
    and c.method = v_recipient.method
    and c.used_at is null
    and c.paid_at is not null;

  insert into public.withdrawal_requests (
    user_id, account_id, withdrawal_account_id, amount,
    account_holder, bank_name, account_number_last4, serial_code_hash,
    transfer_method, network
  ) values (
    auth.uid(), v_account.id, v_recipient.id, v_amount,
    v_recipient.account_holder, v_recipient.bank_name,
    right(v_recipient.account_number, 4), encode(digest(v_serial_input, 'sha256'), 'hex'),
    v_recipient.method, v_recipient.network
  ) returning id into v_request_id;

  update public.member_serial_codes c
  set used_at = now()
  where c.user_id = auth.uid()
    and c.method = v_recipient.method
    and c.used_at is null;

  insert into public.member_activities (user_id, type, metadata)
  values (
    auth.uid(),
    'withdrawal_submitted',
    jsonb_build_object(
      'request_id', v_request_id,
      'amount', v_amount,
      'method', v_recipient.method,
      'network', v_recipient.network
    )
  );
  return v_request_id;
end;
$$;

revoke all on function public.member_get_serial_code_requirements(text) from public;
revoke all on function public.verify_member_serial_code(text, integer, text) from public;
revoke all on function public.admin_get_member_serial_codes(uuid, text) from public;
revoke all on function public.admin_reset_member_serial_codes(uuid, text, numeric[]) from public;
revoke all on function public.submit_withdrawal_request(uuid, uuid, numeric) from public;

grant execute on function public.member_get_serial_code_requirements(text) to authenticated;
grant execute on function public.verify_member_serial_code(text, integer, text) to authenticated;
grant execute on function public.admin_get_member_serial_codes(uuid, text) to authenticated;
grant execute on function public.admin_reset_member_serial_codes(uuid, text, numeric[]) to authenticated;
grant execute on function public.submit_withdrawal_request(uuid, uuid, numeric) to authenticated;

revoke all on public.member_serial_codes from anon;
revoke all on public.member_serial_codes from authenticated;

commit;

notify pgrst, 'reload schema';

-- Deposit receipt storage and confirmation (also available as deposit-receipts.sql)
-- Mellora / private deposit-receipt uploads and administrator confirmation
-- Run once after method-transfer-codes.sql.
-- Stores image bytes in a private Supabase Storage bucket and metadata in public.deposit_receipts.

begin;

create table if not exists public.deposit_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  status text not null default 'confirming',
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  constraint deposit_receipts_status_check check (status in ('confirming', 'confirmed')),
  constraint deposit_receipts_mime_type_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  constraint deposit_receipts_size_check check (size_bytes > 0 and size_bytes <= 10485760),
  constraint deposit_receipts_confirmation_check check (
    (status = 'confirming' and confirmed_at is null and confirmed_by is null)
    or (status = 'confirmed' and confirmed_at is not null)
  )
);

create index if not exists deposit_receipts_user_uploaded_idx
  on public.deposit_receipts (user_id, uploaded_at desc);
create unique index if not exists deposit_receipts_one_confirming_idx
  on public.deposit_receipts (user_id) where status = 'confirming';

alter table public.deposit_receipts enable row level security;
grant select, insert, update on public.deposit_receipts to authenticated;

drop policy if exists "Members can read own deposit receipts" on public.deposit_receipts;
create policy "Members can read own deposit receipts"
  on public.deposit_receipts for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Members can upload own confirming receipts" on public.deposit_receipts;
create policy "Members can upload own confirming receipts"
  on public.deposit_receipts for insert to authenticated
  with check (
    auth.uid() = user_id
    and status = 'confirming'
    and confirmed_at is null
    and confirmed_by is null
    and image_path like auth.uid()::text || '/%'
  );

drop policy if exists "Admins can read member deposit receipts" on public.deposit_receipts;
create policy "Admins can read member deposit receipts"
  on public.deposit_receipts for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins can confirm member deposit receipts" on public.deposit_receipts;
create policy "Admins can confirm member deposit receipts"
  on public.deposit_receipts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deposit-receipts',
  'deposit-receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can upload own receipt images" on storage.objects;
create policy "Members can upload own receipt images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deposit-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members can read own receipt images" on storage.objects;
create policy "Members can read own receipt images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deposit-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Members can remove own unlinked receipt images" on storage.objects;
create policy "Members can remove own unlinked receipt images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deposit-receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.deposit_receipts r
      where r.image_path = name
    )
  );

drop policy if exists "Admins can read member receipt images" on storage.objects;
create policy "Admins can read member receipt images"
  on storage.objects for select to authenticated
  using (bucket_id = 'deposit-receipts' and public.is_admin());

alter table public.member_activities
  drop constraint if exists member_activities_type_check;
alter table public.member_activities
  add constraint member_activities_type_check check (type in (
    'deposit_clicked',
    'deposit_receipt_uploaded',
    'deposit_receipt_confirmed',
    'withdrawal_started',
    'withdrawal_method_selected',
    'withdrawal_details_saved',
    'withdrawal_amount_entered',
    'withdrawal_previewed',
    'withdrawal_serial_codes_started',
    'withdrawal_serial_code_confirmed',
    'withdrawal_draft_resumed',
    'withdrawal_submitted',
    'transfer_processing',
    'transfer_pending'
  ));

create or replace function public.record_deposit_receipt_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  if tg_op = 'INSERT' then
    v_type := 'deposit_receipt_uploaded';
  elsif new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    v_type := 'deposit_receipt_confirmed';
  else
    return new;
  end if;

  insert into public.member_activities (user_id, type, metadata)
  values (
    new.user_id,
    v_type,
    jsonb_build_object('receipt_id', new.id, 'file_name', new.original_name)
  );
  return new;
end;
$$;

revoke all on function public.record_deposit_receipt_activity() from public;

drop trigger if exists deposit_receipt_activity on public.deposit_receipts;
create trigger deposit_receipt_activity
  after insert or update of status on public.deposit_receipts
  for each row execute procedure public.record_deposit_receipt_activity();

create or replace function public.notify_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_message text;
  v_notification_type text := 'activity';
  v_amount text := nullif(new.metadata ->> 'amount', '');
  v_method text := case new.metadata ->> 'method'
    when 'bank' then 'Bank transfer'
    when 'paypal' then 'PayPal'
    when 'usdt' then 'USDT'
    when 'cash_app' then 'Cash App'
    when 'wise' then 'Wise'
    when 'venmo' then 'Venmo'
    else 'Transfer'
  end;
begin
  case new.type
    when 'deposit_clicked' then
      v_title := 'Deposit instructions opened';
      v_message := 'You opened your administrator-provided deposit instructions.';
    when 'deposit_receipt_uploaded' then
      v_title := 'Receipt uploaded';
      v_message := 'Your payment receipt was uploaded and is confirming until an administrator reviews it.';
    when 'deposit_receipt_confirmed' then
      v_title := 'Receipt confirmed';
      v_message := 'An administrator confirmed your payment receipt.';
    when 'withdrawal_started' then
      v_title := 'Transfer started';
      v_message := 'You started a new transfer from your dashboard.';
    when 'withdrawal_method_selected' then
      v_title := 'Transfer method selected';
      v_message := v_method || ' was selected for your transfer.';
    when 'withdrawal_details_saved' then
      v_title := 'Transfer details saved';
      v_message := 'Your ' || v_method || ' recipient details were saved.';
    when 'withdrawal_amount_entered' then
      v_title := 'Transfer amount added';
      v_message := 'A transfer amount of $' || coalesce(v_amount, '0.00') || ' was added.';
    when 'withdrawal_previewed' then
      v_title := 'Transfer previewed';
      v_message := 'You reviewed your transfer details and amount.';
    when 'withdrawal_serial_codes_started' then
      v_title := 'Transfer authorization started';
      v_message := 'Your transfer authorization is now in progress.';
    when 'withdrawal_serial_code_confirmed' then
      v_title := 'Authorization confirmed';
      v_message := 'A transfer authorization was confirmed successfully.';
    when 'withdrawal_draft_resumed' then
      v_title := 'Transfer resumed';
      v_message := 'You reopened your saved ' || v_method || ' progress.';
    when 'transfer_processing' then
      v_notification_type := 'transfer';
      v_title := 'Transfer processing';
      v_message := v_method || ' amount of $' || coalesce(v_amount, '0.00') || ' was added to Processing transfers.';
    when 'transfer_pending' then
      v_notification_type := 'transfer';
      v_title := 'Transfer pending';
      v_message := v_method || ' amount of $' || coalesce(v_amount, '0.00') || ' moved to Pending transfers.';
    when 'withdrawal_submitted' then
      v_notification_type := 'transfer';
      v_title := 'Transfer request pending';
      v_message := v_method || ' request for $' || coalesce(v_amount, '0.00') || ' is pending review.';
    else
      v_title := 'Account activity';
      v_message := 'A new ' || replace(new.type, '_', ' ') || ' event was recorded on your Mellora profile.';
  end case;

  insert into public.notifications (user_id, type, title, message)
  values (new.user_id, v_notification_type, v_title, v_message);
  return new;
end;
$$;

revoke all on function public.notify_member_activity() from public;

commit;

notify pgrst, 'reload schema';
