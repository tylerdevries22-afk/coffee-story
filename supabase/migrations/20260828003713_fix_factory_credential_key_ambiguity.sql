-- Forward repair for the first hosted factory migration. The PL/pgSQL
-- variable must not share a name with the credential_key conflict target.
create or replace function public.create_platform_onboarding_run(
  input_blueprint_id uuid,
  input_business_name text,
  input_tenant_slug text,
  input_location_name text,
  input_timezone text,
  input_website_url text,
  input_idempotency_key uuid,
  input_created_by uuid,
  input_tasks jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run uuid;
  task_entry jsonb;
  credential_requirement_key text;
begin
  if jsonb_typeof(input_tasks) is distinct from 'array'
     or jsonb_array_length(input_tasks) < 1
     or jsonb_array_length(input_tasks) > 32 then
    raise exception using errcode = '22023', message = 'invalid_factory_tasks';
  end if;

  select run.id into target_run
  from public.platform_onboarding_runs run
  where run.idempotency_key = input_idempotency_key
     or run.tenant_slug = input_tenant_slug
  order by (run.idempotency_key = input_idempotency_key) desc
  limit 1;

  if target_run is null then
    insert into public.platform_onboarding_runs (
      industry_blueprint_id, business_name, tenant_slug, location_name,
      timezone, website_url, state, stage, idempotency_key, created_by
    ) values (
      input_blueprint_id, btrim(input_business_name), input_tenant_slug,
      btrim(input_location_name), input_timezone, nullif(btrim(input_website_url), ''),
      'running', 'intake', input_idempotency_key, input_created_by
    ) returning id into target_run;
  elsif not exists (
    select 1 from public.platform_onboarding_runs run
    where run.id = target_run
      and run.industry_blueprint_id = input_blueprint_id
      and run.business_name = btrim(input_business_name)
  ) then
    raise exception using errcode = '23505', message = 'tenant_slug_already_in_use';
  end if;

  for task_entry in select value from jsonb_array_elements(input_tasks)
  loop
    insert into public.platform_onboarding_tasks (
      run_id, task_key, label, stage, provider, state, dependency_keys,
      credential_keys, timeout_ms, maximum_attempts
    ) values (
      target_run,
      task_entry->>'key',
      task_entry->>'label',
      task_entry->>'stage',
      task_entry->>'provider',
      case when task_entry->>'key' = 'research-brand' then 'running' else 'pending' end,
      array(select jsonb_array_elements_text(coalesce(task_entry->'dependsOn', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(task_entry->'credentialKeys', '[]'::jsonb))),
      (task_entry->>'timeoutMs')::integer,
      (task_entry->>'maximumAttempts')::integer
    ) on conflict (run_id, task_key) do nothing;

    for credential_requirement_key in
      select jsonb_array_elements_text(coalesce(task_entry->'credentialKeys', '[]'::jsonb))
    loop
      insert into public.platform_credential_requirements (
        run_id, provider, credential_key, owner_role, storage_system
      ) values (
        target_run,
        task_entry->>'provider',
        credential_requirement_key,
        'platform',
        'doppler'
      ) on conflict (run_id, credential_key) do nothing;
    end loop;
  end loop;

  insert into public.platform_factory_audit_events (
    run_id, actor_id, event_type, correlation_id, metadata
  ) values (
    target_run, input_created_by, 'onboarding.run_created', input_idempotency_key,
    jsonb_build_object('tenantSlug', input_tenant_slug, 'schemaVersion', 1)
  ) on conflict (event_type, correlation_id) do nothing;

  return target_run;
end $$;

revoke all on function public.create_platform_onboarding_run(
  uuid, text, text, text, text, text, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.create_platform_onboarding_run(
  uuid, text, text, text, text, text, uuid, uuid, jsonb
) to service_role;
