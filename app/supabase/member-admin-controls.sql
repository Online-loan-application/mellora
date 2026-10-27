-- Mellora per-member administration
-- Run once after schema.sql, dashboard-update.sql, account-movements.sql,
-- and payment-requests.sql (whichever were previously installed).
-- Adds per-user deposit instructions, activity tracking, and four serial codes
-- with four amounts. The withdrawal amount must equal the four amounts' total.

-- pgcrypto supplies gen_random_bytes() and digest(). Supabase commonly installs
-- extensions in the extensions schema, which is included in crypto functions below.
create extension if not exists pgcrypto with schema extensions;

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
