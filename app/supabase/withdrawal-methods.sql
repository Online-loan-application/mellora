-- Mellora / multiple saved withdrawal methods
-- Run once after persistent-admin-codes.sql.
-- Adds bank, PayPal, USDT, Cash App, Wise, and Venmo recipient details.
-- USDT supports TRC20, ERC20, and BEP20. Requests remain pending and do not
-- debit balances or create completed transactions automatically.

begin;

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

commit;

notify pgrst, 'reload schema';
