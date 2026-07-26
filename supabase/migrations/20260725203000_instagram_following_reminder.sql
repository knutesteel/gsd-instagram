alter table public.instagram_connections
  add column if not exists last_following_import_at timestamptz;
