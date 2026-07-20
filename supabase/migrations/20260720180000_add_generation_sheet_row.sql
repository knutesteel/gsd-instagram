alter table public.articles
  add column if not exists generation_sheet_row integer;
