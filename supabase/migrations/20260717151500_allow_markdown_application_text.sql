update storage.buckets
set allowed_mime_types = array['application/pdf','text/plain','text/markdown','application/text','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword']
where id = 'prompt-documents';
