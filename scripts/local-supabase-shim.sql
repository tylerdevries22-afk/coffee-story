-- A minimal stand-in for the schemas Supabase manages, so the forward-only
-- migration chain can be applied to a plain PostgreSQL and the release
-- assertions run without Docker.
--
-- This exists because the only CI job with a database does not run on pull
-- requests, so a migration or an assertion can be wrong for a whole day before
-- anything executes it. With this shim the chain applies locally in seconds.
--
-- What it is NOT: it does not authenticate anyone, does not enforce anything
-- Supabase enforces at the edge, and its `auth.uid()` reads a session setting
-- rather than a verified JWT. It is enough to apply DDL and to evaluate the
-- catalog facts the readiness assertions state -- nothing more. A passing run
-- here is a necessary condition for the hosted gate, never a substitute for it.
--
-- Roles are cluster-wide, so every role creation below is guarded and this
-- file is safe to re-run against a fresh database on the same server.

-- Minimal local stand-in for the Supabase-managed schemas, so the forward-only
-- chain can be applied to a plain PostgreSQL 17 and the readiness head called.
do $shim$
begin
  -- Roles are cluster-wide, so a re-run of this shim must not fail on them.
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
end
$shim$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists realtime;
create schema if not exists vault;
create extension if not exists pgcrypto with schema public;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb
  language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb
);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;

create table realtime.messages (id bigserial primary key, topic text, extension text);
create or replace function realtime.topic() returns text
  language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique, secret text, created_at timestamptz default now()
);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language plpgsql as $$
  declare new_id uuid;
  begin insert into vault.secrets (name, secret) values (new_name, new_secret) returning id into new_id; return new_id; end $$;

grant usage on schema auth, storage, realtime, vault to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- The CLI's own bookkeeping table; one migration rewrites history in it.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
