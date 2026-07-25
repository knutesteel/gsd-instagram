alter table public.articles
  add column if not exists is_favorite boolean not null default false;
