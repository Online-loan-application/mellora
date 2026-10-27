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
    where user_id = auth.uid() and slot < p_slot and used_at is null and paid_at is null
  ) then
    raise exception 'Confirm the previous serial code before continuing.';
  end if;

  select * into v_code_record
  from public.member_serial_codes
  where user_id = auth.uid() and slot = p_slot and used_at is null;

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
    where user_id = auth.uid() and slot = p_slot and used_at is null;

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
