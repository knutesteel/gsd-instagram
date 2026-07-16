alter table public.prompt_documents add column text_content text;
update storage.buckets set allowed_mime_types = array['application/pdf','text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'] where id = 'prompt-documents';
