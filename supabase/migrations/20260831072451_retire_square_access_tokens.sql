-- Reconnecting or refreshing replaces the credential that new work uses, but
-- an order/refund request can already have resolved the prior access token.
-- Revoking it in that hand-off window turns an otherwise valid request into a
-- Square 401. Keep the old ciphertext in this service-only queue for one cron
-- interval, then revoke it from the authenticated maintenance job.
--
-- Tenant identifiers remain on every row, but deliberately have no foreign
-- keys: an owner can disconnect or delete a location while an older token
-- awaits retirement. Cascading this row would lose the last copy of that
-- credential and leave it live at Square.
create table public.square_access_token_retirements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  location_id uuid not null,
  access_token_encrypted text not null unique,
  retire_after timestamptz not null,
  created_at timestamptz not null default now()
);

create index square_access_token_retirements_due_idx
  on public.square_access_token_retirements (retire_after);

-- This table holds an AES-GCM ciphertext, but client access would still allow
-- correlation and turn a key-management incident into token disclosure. It is
-- exclusively for the service-role maintenance path.
alter table public.square_access_token_retirements enable row level security;
revoke all on public.square_access_token_retirements from anon, authenticated;
grant all on table public.square_access_token_retirements to service_role;
create policy square_access_token_retirements_service
  on public.square_access_token_retirements
  for all to service_role
  using (true) with check (true);

-- Keep the release probe fail-closed: deployment must not serve code that can
-- queue an old token but has no durable, private worker queue to retire it.
alter function public.platform_release_readiness()
  rename to platform_release_readiness_20260831000100;
alter function public.platform_release_readiness_20260831000100() set schema app;
revoke all on function app.platform_release_readiness_20260831000100()
  from public, anon, authenticated;
grant execute on function app.platform_release_readiness_20260831000100()
  to service_role;

create or replace function public.platform_release_readiness()
returns text language plpgsql stable security invoker set search_path = '' as $$
begin
  if app.platform_release_readiness_20260831000100() <> '20260831000100' then
    raise exception 'Square renewal readiness prerequisite is incomplete';
  end if;
  if pg_catalog.to_regclass('public.square_access_token_retirements') is null
    or pg_catalog.to_regclass('public.square_access_token_retirements_due_idx') is null then
    raise exception 'Square access-token retirement queue is missing';
  end if;
  return '20260831072451';
end $$;
revoke all on function public.platform_release_readiness()
  from public, anon, authenticated;
grant execute on function public.platform_release_readiness()
  to service_role;
