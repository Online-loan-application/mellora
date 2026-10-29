-- Mellora / persistent 30-minute delay between serial-code pages
-- Run once after resume-transfer-drafts.sql.
-- The timestamp belongs to one member + withdrawal method draft, so refreshing
-- or closing the browser cannot restart or erase that method's countdown.

begin;

alter table public.member_transfer_drafts
  add column if not exists next_code_available_at timestamptz;

commit;

notify pgrst, 'reload schema';
