create type public.prompt_document_kind as enum ('icp','voice_guide');

create table public.prompt_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.prompt_document_kind not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index prompt_documents_user_kind_idx on public.prompt_documents (user_id, kind, created_at desc);
alter table public.prompt_documents enable row level security;
create policy "users manage their prompt documents" on public.prompt_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prompt-documents','prompt-documents',false,10485760,array['application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do nothing;

create policy "users view their prompt documents" on storage.objects for select to authenticated
  using (bucket_id = 'prompt-documents' and owner_id = (select auth.uid()::text));
create policy "users upload their prompt documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'prompt-documents' and owner_id = (select auth.uid()::text));
create policy "users update their prompt documents" on storage.objects for update to authenticated
  using (bucket_id = 'prompt-documents' and owner_id = (select auth.uid()::text))
  with check (bucket_id = 'prompt-documents' and owner_id = (select auth.uid()::text));
create policy "users delete their prompt documents" on storage.objects for delete to authenticated
  using (bucket_id = 'prompt-documents' and owner_id = (select auth.uid()::text));
