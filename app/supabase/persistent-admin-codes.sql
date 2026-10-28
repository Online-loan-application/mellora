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
