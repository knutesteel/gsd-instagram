alter table public.instagram_connections
  add column if not exists user_access_token_encrypted text,
  add column if not exists token_last_refreshed_at timestamptz;

comment on column public.instagram_connections.user_access_token_encrypted is
  'Encrypted long-lived Facebook user token used server-side to renew the Page token before expiry.';

comment on column public.instagram_connections.token_last_refreshed_at is
  'Last successful automatic Meta token renewal.';

