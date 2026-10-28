-- Mellora / independent resumable transfer drafts for each withdrawal method
-- Run once after withdrawal-methods.sql.
-- A draft stores recipient/account references, the original amount, and the
-- member's serial-page progress. It never stores entered serial-code values.

begin;

create table if not exists public.member_transfer_drafts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null check (method in ('bank', 'paypal', 'usdt', 'cash_app', 'wise', 'venmo')),
  withdrawal_account_id uuid not null references public.withdrawal_accounts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  serial_step integer not null default 0 check (serial_step between 0 and 3),
  confirmed_codes boolean[] not null default '{false,false,false,false}',
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

commit;

notify pgrst, 'reload schema';
