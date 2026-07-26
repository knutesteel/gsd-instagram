alter table public.instagram_following
  add column if not exists collaboration_status text not null default 'explore'
  check (collaboration_status in ('explore', 'reached_out', 'in_discussions', 'in_place', 'archived')),
  add column if not exists content_analysis text not null default '',
  add column if not exists brand_fit_analysis text not null default '',
  add column if not exists existing_collaborations text not null default '',
  add column if not exists recommended_outreach text not null default '',
  add column if not exists researched_at timestamptz;

update public.instagram_following
set collaboration_status = 'explore'
where collaboration_status is null;

create index if not exists instagram_following_user_relationship_status_idx
  on public.instagram_following (user_id, relationship_type, collaboration_status);

