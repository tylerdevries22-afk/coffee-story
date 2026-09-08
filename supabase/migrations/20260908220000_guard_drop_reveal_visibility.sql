-- Keep unrevealed scheduled drops private at the database boundary.
--
-- Clients request scheduled rows so revealed teasers can render before their
-- order window opens. The original policy exposed every scheduled row,
-- including rows whose reveal_at was still in the future. Staff retain their
-- operational view; guests receive only rows the shared visibility function
-- classifies as revealed, orderable, or ended.
drop policy if exists drops_select on public.drops;
create policy drops_select on public.drops for select
  using (
    app.is_brand_staff(brand_id)
    or app.drop_visibility(drops, pg_catalog.now()) <> 'hidden'
  );

create or replace function app.assert_drop_reveal_visibility()
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  predicate text;
begin
  select qual into predicate
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'drops'
    and policyname = 'drops_select';

  if predicate is null
    or pg_catalog.strpos(predicate, 'is_brand_staff') = 0
    or pg_catalog.strpos(predicate, 'drop_visibility') = 0
    or pg_catalog.strpos(predicate, '''hidden''') = 0
  then
    raise exception 'drops_select does not enforce reveal visibility';
  end if;
end
$$;

revoke all on function app.assert_drop_reveal_visibility()
  from public, anon, authenticated;
grant execute on function app.assert_drop_reveal_visibility() to service_role;

select app.register_release(
  '20260908220000',
  'guard drop reveal visibility at the database boundary',
  'app.assert_drop_reveal_visibility()'::regprocedure
);
