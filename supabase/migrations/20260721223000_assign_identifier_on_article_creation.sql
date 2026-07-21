create or replace function public.assign_article_generation_identifier()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  next_identifier bigint;
begin
  if new.generation_identifier is not null
     and btrim(new.generation_identifier) <> '' then
    return new;
  end if;

  -- Serialize identifier allocation so simultaneous article inserts cannot
  -- select the same next number.
  perform pg_advisory_xact_lock(hashtext('public.articles.generation_identifier'));

  select coalesce(max(generation_identifier::bigint), 0) + 1
    into next_identifier
    from public.articles
   where generation_identifier ~ '^[0-9]+$';

  new.generation_identifier := next_identifier::text;
  return new;
end;
$$;

drop trigger if exists assign_article_generation_identifier_before_insert
  on public.articles;

create trigger assign_article_generation_identifier_before_insert
before insert on public.articles
for each row
execute function public.assign_article_generation_identifier();

-- Preserve creation order while assigning the next available numbers to any
-- legacy rows created before the trigger existed.
do $$
declare
  article record;
  next_identifier bigint;
begin
  perform pg_advisory_xact_lock(hashtext('public.articles.generation_identifier'));

  select coalesce(max(generation_identifier::bigint), 0) + 1
    into next_identifier
    from public.articles
   where generation_identifier ~ '^[0-9]+$';

  for article in
    select id
      from public.articles
     where generation_identifier is null
        or btrim(generation_identifier) = ''
     order by created_at, id
  loop
    update public.articles
       set generation_identifier = next_identifier::text
     where id = article.id;
    next_identifier := next_identifier + 1;
  end loop;
end;
$$;
