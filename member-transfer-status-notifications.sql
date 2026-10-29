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
