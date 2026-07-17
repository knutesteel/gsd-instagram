alter table public.articles alter column status drop default;
alter table public.articles alter column status type text using (
  case
    when status::text in ('produced') then 'produced'
    when status::text in ('ready') then 'ready'
    when status::text in ('discarded','removed') then 'discarded'
    else 'new'
  end
);
alter table public.articles drop constraint if exists articles_status_check;
alter table public.articles add constraint articles_status_check check (status in ('new','produced','ready','posted','discarded'));
alter table public.articles alter column status set default 'new';
