-- Register the publishing and social connectors, and teach the registry the two
-- states they need:
--   * `manual_only` availability, for providers that publish no API at all
--     (Amazon KDP and ACX). They are configurable, but the work is an upload.
--   * `manual_import` installation status, the resting state for those rows.
-- Constraints are located by definition rather than by assumed name so the
-- migration is safe against auto-generated constraint names.

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.connector_registry'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%coming_soon%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.connector_registry drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.connector_registry
  add constraint connector_registry_availability_check check (availability in (
    'available', 'setup_required', 'provider_approval_required',
    'manual_only', 'uncertified', 'coming_soon', 'disabled'
  ));

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.connector_registry'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%communications%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.connector_registry drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.connector_registry
  add constraint connector_registry_category_check check (category in (
    'google', 'commerce', 'finance', 'communications', 'marketing',
    'platform', 'developer', 'distribution'
  ));

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.connector_installations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%reauthorization_required%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.connector_installations drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.connector_installations
  add constraint connector_installations_status_check check (status in (
    'available', 'setup_required', 'provider_approval_required', 'connecting',
    'connected_healthy', 'connected_degraded', 'reauthorization_required',
    'disabled', 'revoked', 'uncertified', 'manual_import'
  ));

insert into public.connector_registry (
  provider_key, display_name, category, availability, description,
  logo_path, logo_source_url, logo_license, brand_color, documentation_url, is_active
)
values
  (
    'meta-business-suite', 'Meta Business Suite', 'marketing', 'provider_approval_required',
    'Facebook and Instagram pages, post insights, ad reporting, and lead forms.',
    '/integrations/meta.svg', 'https://simpleicons.org/?q=meta',
    'CC0-1.0 Simple Icons', '#0467DF',
    'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow', true
  ),
  (
    'youtube', 'YouTube', 'marketing', 'available',
    'Channel uploads, video metadata, playlists, and YouTube Analytics reporting.',
    '/integrations/youtube.svg', 'https://simpleicons.org/?q=youtube',
    'CC0-1.0 Simple Icons', '#FF0000',
    'https://developers.google.com/youtube/v3/guides/authentication', true
  ),
  (
    'tiktok', 'TikTok', 'marketing', 'provider_approval_required',
    'Creator profile, video list, direct post publishing, and post analytics.',
    '/integrations/tiktok.svg', 'https://simpleicons.org/?q=tiktok',
    'CC0-1.0 Simple Icons', '#000000',
    'https://developers.tiktok.com/doc/login-kit-web', true
  ),
  (
    'transistor', 'Transistor', 'marketing', 'available',
    'Podcast shows, episode publishing, and per-episode download analytics.',
    '/integrations/transistor.svg', 'https://transistor.fm/about/press/',
    'Brand guidelines, initials only', '#5B5BD6', 'https://developers.transistor.fm/', true
  ),
  (
    'beehiiv', 'beehiiv', 'marketing', 'available',
    'Newsletter posts, subscriber counts, segments, and send performance.',
    '/integrations/beehiiv.svg', 'https://www.beehiiv.com/press',
    'Brand guidelines, initials only', '#FFCC33',
    'https://developers.beehiiv.com/welcome/create-an-api-key', true
  ),
  (
    'kindle-direct-publishing', 'Kindle Direct Publishing', 'commerce', 'manual_only',
    'Ebook and paperback royalties imported from the KDP reports export.',
    '/integrations/kindle-direct-publishing.svg',
    'https://kdp.amazon.com/en_US/help/topic/G200634360',
    'Brand guidelines, initials only', '#FF9900',
    'https://kdp.amazon.com/en_US/help/topic/GVTTXHKHVPAPBEDQ', true
  ),
  (
    'acx-audiobooks', 'ACX Audiobooks', 'commerce', 'manual_only',
    'Audiobook sales and royalty statements imported from the ACX reports export.',
    '/integrations/acx-audiobooks.svg', 'https://simpleicons.org/?q=audible',
    'CC0-1.0 Simple Icons', '#F8991C', 'https://help.acx.com/s/audiobook-publishing', true
  )
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  availability = excluded.availability,
  description = excluded.description,
  logo_path = excluded.logo_path,
  logo_source_url = excluded.logo_source_url,
  logo_license = excluded.logo_license,
  brand_color = excluded.brand_color,
  documentation_url = excluded.documentation_url,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.connector_capabilities (
  provider_id, capability_key, display_name, access_mode, oauth_scopes, description
)
select registry.id, seed.capability_key, seed.display_name, seed.access_mode,
       seed.oauth_scopes, seed.description
from (values
  ('meta-business-suite', 'pages.read', 'Pages', 'read', array['pages_show_list']::text[], 'List the Pages this organization manages.'),
  ('meta-business-suite', 'pages.publish', 'Publish to Pages', 'write', array['pages_manage_posts']::text[], 'Publish reviewed posts to a selected Page.'),
  ('meta-business-suite', 'instagram.read', 'Instagram', 'read', array['instagram_basic']::text[], 'Read the linked Instagram professional account.'),
  ('meta-business-suite', 'insights.read', 'Post insights', 'read', array['read_insights']::text[], 'Read organic post and Page insights.'),
  ('meta-business-suite', 'ads.reporting', 'Ad reporting', 'read', array['ads_read']::text[], 'Read ad spend and performance for reconciliation.'),
  ('meta-business-suite', 'leadgen.read', 'Lead forms', 'read', array['leads_retrieval']::text[], 'Read lead form submissions for follow-up.'),
  ('youtube', 'channel.read', 'Channel', 'read', array['https://www.googleapis.com/auth/youtube.readonly']::text[], 'Identify the connected channel.'),
  ('youtube', 'videos.read', 'Videos', 'read', array['https://www.googleapis.com/auth/youtube.readonly']::text[], 'Read video metadata and status.'),
  ('youtube', 'videos.upload', 'Upload videos', 'write', array['https://www.googleapis.com/auth/youtube.upload']::text[], 'Upload a video as private until published.'),
  ('youtube', 'playlists.write', 'Playlists', 'write', array['https://www.googleapis.com/auth/youtube']::text[], 'Organize uploads into playlists.'),
  ('youtube', 'analytics.reporting', 'Analytics', 'read', array['https://www.googleapis.com/auth/yt-analytics.readonly']::text[], 'Read channel and video analytics.'),
  ('tiktok', 'profile.read', 'Creator profile', 'read', array['user.info.basic']::text[], 'Identify the connected creator account.'),
  ('tiktok', 'videos.read', 'Videos', 'read', array['video.list']::text[], 'Read the published video list.'),
  ('tiktok', 'videos.publish', 'Publish videos', 'write', array['video.publish']::text[], 'Publish a video through the Content Posting API.'),
  ('tiktok', 'analytics.read', 'Post analytics', 'read', array['video.list']::text[], 'Read per-video performance for reconciliation.'),
  ('transistor', 'shows.read', 'Shows', 'read', array[]::text[], 'List the podcast shows on the account.'),
  ('transistor', 'episodes.read', 'Episodes', 'read', array[]::text[], 'Read episode metadata and publish state.'),
  ('transistor', 'episodes.write', 'Publish episodes', 'write', array[]::text[], 'Create and publish an episode.'),
  ('transistor', 'analytics.read', 'Download analytics', 'read', array[]::text[], 'Read per-episode download analytics.'),
  ('beehiiv', 'publications.read', 'Publications', 'read', array[]::text[], 'Identify the connected publication.'),
  ('beehiiv', 'posts.read', 'Posts', 'read', array[]::text[], 'Read newsletter posts and send stats.'),
  ('beehiiv', 'posts.write', 'Publish posts', 'write', array[]::text[], 'Create and schedule a newsletter post.'),
  ('beehiiv', 'subscriptions.read', 'Subscribers', 'read', array[]::text[], 'Read subscriber counts without exporting addresses.'),
  ('beehiiv', 'segments.read', 'Segments', 'read', array[]::text[], 'Read audience segments for targeting.'),
  ('kindle-direct-publishing', 'royalties.import', 'Royalty import', 'read', array[]::text[], 'Import the KDP royalties export.'),
  ('kindle-direct-publishing', 'orders.import', 'Order import', 'read', array[]::text[], 'Import KDP order units by marketplace.'),
  ('kindle-direct-publishing', 'kenp.import', 'KENP import', 'read', array[]::text[], 'Import Kindle Edition Normalized Pages read.'),
  ('acx-audiobooks', 'royalties.import', 'Royalty import', 'read', array[]::text[], 'Import the ACX royalty statement.'),
  ('acx-audiobooks', 'sales.import', 'Sales import', 'read', array[]::text[], 'Import ACX audiobook sales units.')
) as seed(provider_key, capability_key, display_name, access_mode, oauth_scopes, description)
join public.connector_registry registry on registry.provider_key = seed.provider_key
on conflict (provider_id, capability_key) do update set
  display_name = excluded.display_name,
  access_mode = excluded.access_mode,
  oauth_scopes = excluded.oauth_scopes,
  description = excluded.description,
  is_active = true,
  updated_at = now();

insert into public.connector_certifications (
  capability_id, environment, status, contract_version, notes
)
select capability.id, 'sandbox', 'not_started', registry.adapter_contract_version,
       case when registry.availability = 'manual_only'
         then 'Provider publishes no API. Certification covers the import mapping only.'
         else 'Provider sandbox certification is required before this capability can be enabled for a tenant.'
       end
from public.connector_capabilities capability
join public.connector_registry registry on registry.id = capability.provider_id
where registry.provider_key in (
  'meta-business-suite', 'youtube', 'tiktok', 'transistor', 'beehiiv',
  'kindle-direct-publishing', 'acx-audiobooks'
)
on conflict (capability_id, environment, contract_version) do nothing;

-- Onboarding must resolve a manual-only selection to its resting import state
-- instead of claiming setup is required.
create or replace function app.connector_onboarding_status(p_availability text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case p_availability
    when 'manual_only' then 'manual_import'
    when 'provider_approval_required' then 'provider_approval_required'
    else 'setup_required'
  end
$$;
revoke all on function app.connector_onboarding_status(text) from public, anon;
grant execute on function app.connector_onboarding_status(text) to authenticated, service_role;

-- Re-emit the onboarding provisioner so a manual-only selection resolves to its
-- resting import state. The body is unchanged apart from that one expression.
create or replace function public.provision_platform_organization_with_connectors(
  p_idempotency_key uuid,
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_owner_email text,
  p_organization_kind text,
  p_industry_key text,
  p_blueprint_key text,
  p_brand_config jsonb,
  p_location jsonb,
  p_modules jsonb,
  p_network_slug text,
  p_territory jsonb,
  p_inheritance_policy jsonb,
  p_connectors jsonb,
  p_fee_bps integer default 200,
  p_fee_bps_tier2 integer default 150,
  p_tier_threshold_cents bigint default 2500000
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare provisioned jsonb;
declare created_brand_id uuid;
declare normalized_connectors jsonb;
declare stored_connectors jsonb;
begin
  if jsonb_typeof(coalesce(p_connectors, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_connectors, '[]'::jsonb)) > 32
     or exists (
       select 1 from jsonb_array_elements(coalesce(p_connectors, '[]'::jsonb)) item(value)
       where jsonb_typeof(item.value) <> 'string'
     ) then
    raise exception using errcode = '22023', message = 'invalid_connector_selection';
  end if;

  select coalesce(jsonb_agg(requested.provider_key order by requested.provider_key), '[]'::jsonb)
  into normalized_connectors
  from (
    select distinct jsonb_array_elements_text(coalesce(p_connectors, '[]'::jsonb)) as provider_key
  ) requested;

  if exists (
    select 1 from jsonb_array_elements_text(normalized_connectors) requested(provider_key)
    where not exists (
      select 1 from public.connector_registry provider
      where provider.provider_key = requested.provider_key
        and provider.is_active
        and provider.availability not in ('disabled', 'coming_soon', 'uncertified')
    )
  ) then
    raise exception using errcode = '22023', message = 'unknown_connector_selection';
  end if;

  provisioned := public.provision_platform_organization(
    p_idempotency_key, p_name, p_slug, p_owner_user_id, p_owner_email,
    p_organization_kind, p_industry_key, p_blueprint_key, p_brand_config,
    p_location, p_modules, p_network_slug, p_territory, p_inheritance_policy,
    p_fee_bps, p_fee_bps_tier2, p_tier_threshold_cents
  );
  created_brand_id := (provisioned->>'brandId')::uuid;

  select run.request->'connectorIds' into stored_connectors
  from public.organization_provisioning_runs run
  where run.idempotency_key = p_idempotency_key
  for update;
  if stored_connectors is not null and stored_connectors <> normalized_connectors then
    raise exception using errcode = '22023', message = 'idempotency_key_payload_mismatch';
  end if;
  update public.organization_provisioning_runs run
  set request = run.request || jsonb_build_object('connectorIds', normalized_connectors)
  where run.idempotency_key = p_idempotency_key;

  with inserted as (
    insert into public.connector_installations (
      brand_id, provider_id, environment, status, enabled_capabilities, settings,
      connected_by
    )
    select created_brand_id, provider.id, 'production',
      app.connector_onboarding_status(provider.availability),
      '{}'::text[], '{}'::jsonb, (select auth.uid())
    from public.connector_registry provider
    join jsonb_array_elements_text(normalized_connectors) requested(provider_key)
      on requested.provider_key = provider.provider_key
    on conflict (brand_id, provider_id, environment) do nothing
    returning id, provider_id
  )
  insert into public.connector_audit_events (
    brand_id, installation_id, actor_user_id, action, outcome,
    correlation_id, source, detail
  )
  select created_brand_id, inserted.id, (select auth.uid()), 'installation.selected',
    'success', p_idempotency_key, 'hq',
    jsonb_build_object('providerId', inserted.provider_id, 'stage', 'onboarding')
  from inserted;

  return provisioned || jsonb_build_object(
    'connectorCount', jsonb_array_length(normalized_connectors)
  );
end $$;

create or replace function app.assert_publishing_social_connectors()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  registered integer;
  uncovered integer;
  mislabelled integer;
  unadmittable integer;
begin
  select count(*) into registered
  from public.connector_registry
  where provider_key in (
    'meta-business-suite', 'youtube', 'tiktok', 'transistor', 'beehiiv',
    'kindle-direct-publishing', 'acx-audiobooks'
  ) and is_active;
  if registered <> 7 then
    raise exception 'publishing and social connectors are not fully registered';
  end if;

  select count(*) into uncovered
  from public.connector_registry registry
  where registry.provider_key in (
    'meta-business-suite', 'youtube', 'tiktok', 'transistor', 'beehiiv',
    'kindle-direct-publishing', 'acx-audiobooks'
  ) and not exists (
    select 1 from public.connector_capabilities capability
    where capability.provider_id = registry.id and capability.is_active
  );
  if uncovered > 0 then
    raise exception 'a registered connector has no active capability';
  end if;

  if app.connector_onboarding_status('manual_only') <> 'manual_import' then
    raise exception 'manual-only onboarding does not resolve to manual import';
  end if;

  -- Each row must carry the availability its code catalog entry declares. A
  -- divergence is silent and expensive: begin_connector_oauth_state admits only
  -- 'available' and 'provider_approval_required', so a mislabelled OAuth
  -- connector renders a Connect button that can only ever answer 503.
  select count(*) into mislabelled
  from public.connector_registry registry
  join (values
    ('meta-business-suite', 'provider_approval_required'),
    ('youtube', 'available'),
    ('tiktok', 'provider_approval_required'),
    ('transistor', 'available'),
    ('beehiiv', 'available'),
    ('kindle-direct-publishing', 'manual_only'),
    ('acx-audiobooks', 'manual_only')
  ) as expected(provider_key, availability)
    on expected.provider_key = registry.provider_key
  where registry.availability <> expected.availability;
  if mislabelled > 0 then
    raise exception 'a connector registry row disagrees with the code catalog';
  end if;

  -- Every OAuth connector must be admissible by the authorize RPC, or its
  -- Connect button is decorative.
  select count(*) into unadmittable
  from public.connector_registry
  where provider_key in ('meta-business-suite', 'youtube', 'tiktok')
    and availability not in ('available', 'provider_approval_required');
  if unadmittable > 0 then
    raise exception 'an OAuth connector is registered in a state the authorize RPC rejects';
  end if;

  -- The three CHECK constraints this migration re-added must still accept the
  -- values the application writes.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.connector_registry'::regclass
      and conname = 'connector_registry_availability_check'
      and pg_get_constraintdef(oid) like '%manual_only%'
  ) then
    raise exception 'the registry availability constraint does not accept manual_only';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.connector_installations'::regclass
      and conname = 'connector_installations_status_check'
      and pg_get_constraintdef(oid) like '%manual_import%'
  ) then
    raise exception 'the installation status constraint does not accept manual_import';
  end if;
end $$;
revoke all on function app.assert_publishing_social_connectors()
  from public, anon, authenticated;
grant execute on function app.assert_publishing_social_connectors() to service_role;

select app.register_release(
  '20260907120000',
  'publishing and social connectors registered with manual-import support',
  'app.assert_publishing_social_connectors()'::regprocedure
);
