-- Retire in-app prompt management and move all generation states to the Sheet workflow.
alter table public.articles drop constraint if exists articles_status_check;

update public.articles
set status = case status
  when 'produced' then 'generated'
  when 'ready' then 'approved_to_post'
  when 'posted' then 'approved_to_post'
  else status
end;

alter table public.articles
  add constraint articles_status_check
  check (status in ('new', 'sent_to_sheets', 'generated', 'approved_to_post', 'discarded'));

drop table if exists public.prompt_documents;
