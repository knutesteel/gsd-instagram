create table public.instagram_following (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  biography text,
  website text,
  profile_url text,
  profile_picture_url text,
  followers_count bigint,
  media_count bigint,
  followed_at timestamptz,
  profile_data_available boolean not null default false,
  fit_score integer not null default 0,
  fit_label text not null default 'Review',
  fit_analysis text not null default '',
  enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, username)
);

create index instagram_following_user_fit_idx on public.instagram_following (user_id, fit_score desc);
alter table public.instagram_following enable row level security;
create policy "users read their instagram following" on public.instagram_following for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.instagram_following to authenticated;
