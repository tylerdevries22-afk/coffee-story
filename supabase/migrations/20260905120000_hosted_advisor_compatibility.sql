-- Keep the release registry portable across Postgres upgrades and make the
-- activity projection execute with the caller's RLS privileges.
set local search_path = '';

alter view public.activity_board_items set (security_invoker = true);

alter table app.release_assertions
  alter column assertion type text using assertion::text;

create or replace function app.register_release(
  p_release text,
  p_note text,
  p_assertion regprocedure default null
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_assertion is not null and not exists (
    select 1 from pg_catalog.pg_proc proc
    where proc.oid = p_assertion and proc.pronargs = 0
  ) then
    raise exception 'release assertion % must take no arguments', p_assertion;
  end if;
  insert into app.release_assertions (release, note, assertion)
  values (p_release, p_note, p_assertion::text);
end $$;

create or replace function app.assert_hosted_advisor_compatibility()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'app.release_assertions'::regclass
      and attribute.attname = 'assertion'
      and attribute.atttypid = 'pg_catalog.text'::regtype
      and not attribute.attisdropped
  ) then
    raise exception 'release assertions must use an upgrade-safe text identity';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    where relation.oid = 'public.activity_board_items'::regclass
      and coalesce(relation.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'activity board view must use caller privileges';
  end if;
  if exists (
    select 1 from app.release_assertions registered
    where registered.assertion is not null
      and pg_catalog.to_regprocedure(registered.assertion) is null
  ) then
    raise exception 'release registry contains an unresolved assertion';
  end if;
end $$;

revoke all on function app.assert_hosted_advisor_compatibility()
  from public, anon, authenticated;
grant execute on function app.assert_hosted_advisor_compatibility() to service_role;

select app.register_release(
  '20260905120000',
  'hosted advisor compatibility: invoker activity view and portable release registry',
  'app.assert_hosted_advisor_compatibility()'::regprocedure
);
