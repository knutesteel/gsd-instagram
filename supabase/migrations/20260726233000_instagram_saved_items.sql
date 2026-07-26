create table if not exists public.instagram_saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instagram_url text not null,
  shortcode text,
  media_type text not null default 'post',
  title text not null default 'Saved Instagram item',
  saved_at timestamptz,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_saved_items_user_url_key unique (user_id, instagram_url)
);

create index if not exists instagram_saved_items_user_saved_idx
  on public.instagram_saved_items (user_id, saved_at desc nulls last, imported_at desc);

alter table public.instagram_saved_items enable row level security;

drop policy if exists "Users manage their saved Instagram items" on public.instagram_saved_items;
create policy "Users manage their saved Instagram items"
  on public.instagram_saved_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
