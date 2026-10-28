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
  where user_id = auth.uid() and slot = p_slot and used_at is null;

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
