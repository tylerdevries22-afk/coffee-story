-- Connector secrets belong in Supabase Vault. Public connector rows retain
-- only the opaque Vault UUID and non-sensitive account/scope metadata.

alter table public.credential_references
  drop constraint if exists credential_references_secret_handle_check;
alter table public.credential_references
  rename column secret_handle to vault_secret_id;
alter table public.credential_references
  alter column vault_secret_id type uuid using vault_secret_id::uuid;

create unique index credential_references_vault_secret_idx
  on public.credential_references (vault_secret_id);

create or replace function public.store_connector_secret(
  target_brand uuid,
  target_provider_key text,
  plaintext_secret text,
  target_account_label text default '',
  target_scopes text[] default '{}',
  target_expires_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_provider uuid;
  stored_secret uuid;
  reference_id uuid;
begin
  if plaintext_secret is null or length(plaintext_secret) < 8 or length(plaintext_secret) > 24576 then
    raise exception using errcode = '22023', message = 'connector_secret_invalid';
  end if;

  select registry.id into target_provider
    from public.connector_registry registry
   where registry.provider_key = target_provider_key
     and registry.is_active;
  if target_provider is null then
    raise exception using errcode = '22023', message = 'connector_provider_unknown';
  end if;

  stored_secret := vault.create_secret(
    plaintext_secret,
    'connector_' || target_brand::text || '_' || target_provider_key || '_' || gen_random_uuid()::text,
    'Tenant connector credential. Resolve only from a deployed server route.',
    null
  );

  insert into public.credential_references (
    brand_id, provider_id, vault_secret_id, account_label, granted_scopes, expires_at
  ) values (
    target_brand, target_provider, stored_secret, left(coalesce(target_account_label, ''), 160),
    coalesce(target_scopes, '{}'), target_expires_at
  ) returning id into reference_id;

  return reference_id;
end $$;

create or replace function public.resolve_connector_secret(
  target_reference uuid,
  target_brand uuid
) returns text
language sql
security definer
set search_path = ''
stable
as $$
  select secret.decrypted_secret
    from public.credential_references reference
    join vault.decrypted_secrets secret on secret.id = reference.vault_secret_id
   where reference.id = target_reference
     and reference.brand_id = target_brand
     and reference.revoked_at is null
     and (reference.expires_at is null or reference.expires_at > now())
$$;

create or replace function public.revoke_connector_secret(
  target_reference uuid,
  target_brand uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_secret uuid;
begin
  update public.credential_references reference
     set revoked_at = coalesce(reference.revoked_at, now()), updated_at = now()
   where reference.id = target_reference
     and reference.brand_id = target_brand
  returning reference.vault_secret_id into stored_secret;

  if stored_secret is null then return false; end if;
  delete from vault.secrets where id = stored_secret;
  return true;
end $$;

revoke all on function public.store_connector_secret(uuid, text, text, text, text[], timestamptz)
  from public, anon, authenticated;
revoke all on function public.resolve_connector_secret(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_connector_secret(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.store_connector_secret(uuid, text, text, text, text[], timestamptz)
  to service_role;
grant execute on function public.resolve_connector_secret(uuid, uuid)
  to service_role;
grant execute on function public.revoke_connector_secret(uuid, uuid)
  to service_role;

comment on column public.credential_references.vault_secret_id is
  'Opaque Supabase Vault secret UUID. Decrypted values are available only through service-role functions.';
