update public.instagram_following
set
  collaboration_status = 'disqualified',
  pipeline_status = 'Disqualified'
where collaboration_status = 'archived'
   or pipeline_status = 'Archived';

alter table public.instagram_following
  drop constraint if exists instagram_following_collaboration_status_check,
  add constraint instagram_following_collaboration_status_check
    check (collaboration_status in ('explore', 'reached_out', 'in_discussions', 'in_place', 'disqualified')),
  drop constraint if exists instagram_following_pipeline_status_check,
  add constraint instagram_following_pipeline_status_check
    check (pipeline_status in ('Explore', 'Reached Out', 'In Discussions', 'In Place', 'Disqualified'));

update public.instagram_following
set
  collaboration_status = 'disqualified',
  pipeline_status = 'Disqualified',
  updated_at = now()
where lower(coalesce(content_analysis, '')) like '%private%'
   or lower(coalesce(content_analysis, '')) like '%inaccessible%'
   or lower(coalesce(content_analysis, '')) like '%deleted%'
   or lower(coalesce(content_analysis, '')) like '%suspended%'
   or lower(coalesce(content_analysis, '')) like '%spam%'
   or lower(coalesce(brand_fit_analysis, '')) like '%unacceptable%'
   or username = 'health___.care';
