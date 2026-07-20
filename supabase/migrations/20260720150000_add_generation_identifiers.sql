alter table public.articles add column if not exists generation_identifier text;

update public.articles
set generation_identifier = upper(translate(substring(md5(random()::text), 1, 6), '0123456789', 'ghijklmnop'))
where generation_identifier is null;

create unique index if not exists articles_generation_identifier_unique
  on public.articles (generation_identifier);