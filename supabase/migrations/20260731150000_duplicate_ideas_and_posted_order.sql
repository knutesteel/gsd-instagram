alter table public.articles
  add column if not exists posted_at timestamptz;

alter table public.sheet_sync_items
  alter column identifier type text using identifier::text;

create or replace function public.set_article_posted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'posted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.posted_at := coalesce(new.posted_at, now());
  elsif tg_op = 'UPDATE'
        and old.status = 'posted'
        and new.status <> 'posted' then
    new.posted_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_article_posted_at_before_write on public.articles;
create trigger set_article_posted_at_before_write
before insert or update of status on public.articles
for each row execute function public.set_article_posted_at();

update public.articles
set posted_at = coalesce(posted_at, updated_at, created_at)
where status = 'posted'
  and posted_at is null;

create or replace function public.duplicate_article_idea(source_article_id uuid)
returns table (article_id uuid, generation_identifier text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_article public.articles%rowtype;
  source_concept public.post_concepts%rowtype;
  duplicate_id uuid;
  base_identifier text;
  next_variant integer;
  duplicate_identifier text;
  duplicate_fingerprint text;
begin
  select * into source_article
  from public.articles
  where id = source_article_id
    and user_id = (select auth.uid());

  if not found then
    raise exception 'Article not found or access denied.';
  end if;

  if source_article.generation_identifier !~ '^[0-9]+(?:-[0-9]+)?$' then
    raise exception 'The source article does not have a valid generation identifier.';
  end if;

  base_identifier := split_part(source_article.generation_identifier, '-', 1);
  perform pg_advisory_xact_lock(hashtext('duplicate_article_idea:' || source_article.user_id::text || ':' || base_identifier));

  select coalesce(max((regexp_match(generation_identifier, '-([0-9]+)$'))[1]::integer), 0) + 1
    into next_variant
  from public.articles
  where user_id = source_article.user_id
    and generation_identifier ~ ('^' || base_identifier || '-[0-9]+$');

  duplicate_identifier := base_identifier || '-' || next_variant::text;
  duplicate_fingerprint := source_article.url_fingerprint || ':variant:' || next_variant::text;

  insert into public.articles (
    user_id, discovery_run_id, canonical_url, source_url, url_fingerprint,
    title, publisher, author, published_at, updated_at_source, extracted_text,
    category, rank, status, exclusion_reason, generation_identifier,
    generation_sheet_row, post_handoff_at, is_favorite, posted_at
  ) values (
    source_article.user_id, source_article.discovery_run_id, source_article.canonical_url,
    source_article.source_url, duplicate_fingerprint, source_article.title,
    source_article.publisher, source_article.author, source_article.published_at,
    source_article.updated_at_source, source_article.extracted_text,
    source_article.category, source_article.rank, 'new',
    null, duplicate_identifier, null, null, false, null
  ) returning id into duplicate_id;

  select * into source_concept
  from public.post_concepts
  where article_id = source_article.id
    and user_id = source_article.user_id;

  if found then
    insert into public.post_concepts (
      article_id, user_id, voice_guide_version, icp_version, summary,
      relevance_rationale, post_type, panel_count, image_summary,
      detailed_prompt, caption, hashtags
    ) values (
      duplicate_id, source_concept.user_id, source_concept.voice_guide_version,
      source_concept.icp_version, source_concept.summary,
      source_concept.relevance_rationale, source_concept.post_type,
      source_concept.panel_count,
      source_concept.image_summary - 'sheet_images' - 'rendered_images' - 'embedded_images',
      source_concept.detailed_prompt, source_concept.caption, source_concept.hashtags
    );
  end if;

  return query select duplicate_id, duplicate_identifier;
end;
$$;

revoke all on function public.duplicate_article_idea(uuid) from public;
grant execute on function public.duplicate_article_idea(uuid) to authenticated;
