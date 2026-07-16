create extension if not exists pgcrypto;

create type public.article_status as enum ('candidate','proposed','editing','producing','produced','ready','discarded','removed','failed');
create type public.asset_source as enum ('generated','uploaded');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('manual_url','system_search')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  timeframe_hours smallint check (timeframe_hours in (24,48)),
  queries jsonb not null default '[]'::jsonb,
  candidate_count integer not null default 0,
  validated_count integer not null default 0,
  presented_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  discovery_run_id uuid references public.discovery_runs(id) on delete set null,
  canonical_url text not null,
  source_url text not null,
  url_fingerprint text not null,
  title text not null,
  publisher text,
  author text,
  published_at timestamptz,
  updated_at_source timestamptz,
  extracted_text text,
  category text,
  rank smallint check (rank between 1 and 100),
  status public.article_status not null default 'candidate',
  exclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, url_fingerprint)
);

create table public.post_concepts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null unique references public.articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_guide_version text not null default 'GSD Voice v3',
  icp_version text not null default 'GSD ICP v1',
  summary text check (char_length(summary) <= 200),
  relevance_rationale text,
  post_type text check (post_type in ('single_image','carousel','multi_pane_cartoon','reel')),
  panel_count smallint check (panel_count between 1 and 10),
  image_summary jsonb not null default '{}'::jsonb,
  detailed_prompt text,
  caption text,
  hashtags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.post_concepts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence smallint not null default 1,
  media_type text not null check (media_type in ('image','video')),
  source public.asset_source not null,
  storage_path text not null,
  mime_type text,
  generation_prompt text,
  requested_change text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index articles_user_status_rank_idx on public.articles (user_id, status, rank desc, created_at desc);
create index assets_concept_sequence_idx on public.assets (concept_id, sequence);

alter table public.profiles enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.articles enable row level security;
alter table public.post_concepts enable row level security;
alter table public.assets enable row level security;

create policy "profiles are private" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "users manage their discovery runs" on public.discovery_runs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage their articles" on public.articles for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage their concepts" on public.post_concepts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage their assets" on public.assets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-assets','post-assets',false,52428800,array['image/jpeg','image/png','image/webp','video/mp4'])
on conflict (id) do nothing;

create policy "users view their post assets" on storage.objects for select to authenticated
  using (bucket_id = 'post-assets' and owner_id = (select auth.uid()::text));
create policy "users upload their post assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-assets' and owner_id = (select auth.uid()::text));
create policy "users update their post assets" on storage.objects for update to authenticated
  using (bucket_id = 'post-assets' and owner_id = (select auth.uid()::text))
  with check (bucket_id = 'post-assets' and owner_id = (select auth.uid()::text));
create policy "users delete their post assets" on storage.objects for delete to authenticated
  using (bucket_id = 'post-assets' and owner_id = (select auth.uid()::text));
