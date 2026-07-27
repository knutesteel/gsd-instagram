create table if not exists public.sheet_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null check (trigger in ('scheduled_records','scheduled_assets','manual')),
  status text not null default 'running' check (status in ('running','completed','partial','failed')),
  rows_processed integer not null default 0,
  rows_failed integer not null default 0,
  images_imported integer not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.sheet_sync_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id uuid not null references public.articles(id) on delete cascade,
  identifier integer not null,
  stage text not null default 'pending',
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  retry_count integer not null default 0,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_retry_at timestamptz,
  error_message text,
  expected_images integer not null default 0,
  imported_images integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create index if not exists sheet_sync_runs_user_started_idx
  on public.sheet_sync_runs (user_id, started_at desc);
create index if not exists sheet_sync_items_retry_idx
  on public.sheet_sync_items (user_id, status, next_retry_at);

alter table public.sheet_sync_runs enable row level security;
alter table public.sheet_sync_items enable row level security;

create policy "users view their sheet sync runs"
  on public.sheet_sync_runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users view their sheet sync items"
  on public.sheet_sync_items for select to authenticated
  using ((select auth.uid()) = user_id);

create unique index if not exists assets_generated_panel_unique
  on public.assets (concept_id, sequence)
  where source = 'generated' and is_active = true;
