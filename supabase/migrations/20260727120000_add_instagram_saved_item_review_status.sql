alter table public.instagram_saved_items
  add column if not exists review_status text not null default 'not_reviewed';

alter table public.instagram_saved_items
  drop constraint if exists instagram_saved_items_review_status_check;

alter table public.instagram_saved_items
  add constraint instagram_saved_items_review_status_check
  check (review_status in ('not_reviewed', 'keep', 'delete'));

create index if not exists instagram_saved_items_user_review_status_idx
  on public.instagram_saved_items (user_id, review_status);
