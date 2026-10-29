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
