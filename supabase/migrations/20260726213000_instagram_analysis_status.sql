alter table public.instagram_following
  add column if not exists analysis_status text not null default 'not_reviewed'
  check (analysis_status in ('not_reviewed', 'automated_review', 'deep_review', 'unavailable'));

update public.instagram_following
set analysis_status = case
  when researched_at is not null then 'deep_review'
  when collaboration_status = 'disqualified'
    and (
      coalesce(content_analysis, '') ilike '%private%'
      or coalesce(content_analysis, '') ilike '%unavailable%'
      or coalesce(content_analysis, '') ilike '%inaccessible%'
    ) then 'unavailable'
  when nullif(trim(coalesce(fit_analysis, '')), '') is not null then 'automated_review'
  else 'not_reviewed'
end;

create index if not exists instagram_following_analysis_status_idx
  on public.instagram_following (user_id, relationship_type, analysis_status);
