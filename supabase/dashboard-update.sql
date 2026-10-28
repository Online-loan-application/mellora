-- Mellora dashboard update
-- Run once in Supabase Dashboard -> SQL Editor on an existing Mellora project.
-- Adds admin balance editing, direct member messages, and automatic balance alerts.

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

create index if not exists notifications_user_id_created_idx
  on public.notifications(user_id, created_at desc);

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

alter table public.notifications enable row level security;

-- Only administrators may change balances. Members retain read-only access.
drop policy if exists "Admins update account balances" on public.accounts;
create policy "Admins update account balances" on public.accounts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Members can read their own notifications and mark them as read.
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

revoke all on public.notifications from anon;
grant select, insert on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (balance) on public.accounts to authenticated;
