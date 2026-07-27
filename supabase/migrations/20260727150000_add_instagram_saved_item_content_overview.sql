alter table public.instagram_saved_items
  add column if not exists content_overview text not null default '';
