alter table public.articles
  add column if not exists post_handoff_at timestamptz null;

comment on column public.articles.post_handoff_at is
  'Time the user copied the caption and opened Instagram post creation; cleared only by explicit future workflow changes.';
