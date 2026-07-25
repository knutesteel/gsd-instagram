create table public.instagram_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  facebook_page_id text not null,
  facebook_page_name text,
  instagram_account_id text not null,
  instagram_username text,
  profile_picture_url text,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  followers_count integer,
  media_count integer,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.instagram_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.instagram_connections(id) on delete cascade,
  instagram_media_id text not null,
  article_id uuid references public.articles(id) on delete set null,
  caption text,
  media_type text,
  media_product_type text,
  media_url text,
  thumbnail_url text,
  permalink text,
  published_at timestamptz,
  like_count integer not null default 0,
  comments_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, instagram_media_id)
);

create table public.instagram_media_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid not null references public.instagram_media(id) on delete cascade,
  captured_on date not null default current_date,
  views bigint not null default 0,
  reach bigint not null default 0,
  saved bigint not null default 0,
  shares bigint not null default 0,
  total_interactions bigint not null default 0,
  watch_time_ms bigint not null default 0,
  average_watch_time_ms numeric not null default 0,
  raw_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (media_id, captured_on)
);

create index instagram_media_user_published_idx on public.instagram_media (user_id, published_at desc);
create index instagram_insights_media_date_idx on public.instagram_media_insights (media_id, captured_on desc);
create index instagram_insights_user_idx on public.instagram_media_insights (user_id);

alter table public.instagram_connections enable row level security;
alter table public.instagram_media enable row level security;
alter table public.instagram_media_insights enable row level security;

create policy "users read their instagram connection" on public.instagram_connections for select to authenticated using ((select auth.uid()) = user_id);
create policy "users delete their instagram connection" on public.instagram_connections for delete to authenticated using ((select auth.uid()) = user_id);
create policy "users read their instagram media" on public.instagram_media for select to authenticated using ((select auth.uid()) = user_id);
create policy "users update their instagram media match" on public.instagram_media for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users read their instagram insights" on public.instagram_media_insights for select to authenticated using ((select auth.uid()) = user_id);

grant select, delete on public.instagram_connections to authenticated;
grant select, update on public.instagram_media to authenticated;
grant select on public.instagram_media_insights to authenticated;
