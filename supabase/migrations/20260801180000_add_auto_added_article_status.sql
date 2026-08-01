alter table public.articles
  drop constraint if exists articles_status_check;

alter table public.articles
  add constraint articles_status_check
  check (status in ('new', 'auto_added', 'sent_to_sheets', 'generated', 'approved_to_post', 'posted', 'discarded'));

update public.articles
set status = 'auto_added'
where status = 'new'
  and created_at >= timestamptz '2026-07-28 00:00:00 America/New_York';
