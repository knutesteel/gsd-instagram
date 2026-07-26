alter table public.instagram_following
  add column if not exists relationship_type text not null default 'following'
  check (relationship_type in ('following', 'followers'));

alter table public.instagram_following
  drop constraint if exists instagram_following_user_id_username_key;

alter table public.instagram_following
  add constraint instagram_following_user_relationship_username_key
  unique (user_id, username, relationship_type);

create index if not exists instagram_following_user_relationship_fit_idx
  on public.instagram_following (user_id, relationship_type, fit_score desc);

alter table public.instagram_connections
  add column if not exists last_followers_import_at timestamptz;
