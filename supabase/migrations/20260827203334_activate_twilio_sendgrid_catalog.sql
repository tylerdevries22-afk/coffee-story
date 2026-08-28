insert into public.connector_registry (
  provider_key, display_name, category, availability, description,
  logo_path, logo_source_url, logo_license, brand_color, documentation_url, is_active
)
values
  (
    'twilio', 'Twilio', 'communications', 'setup_required',
    'Verified SMS senders, delivery status, quotas, and webhook reconciliation.',
    '/integrations/twilio.svg', 'https://www.twilio.com/company/brand',
    'Official Twilio brand asset', '#F22F46', 'https://www.twilio.com/docs/messaging', true
  ),
  (
    'sendgrid', 'SendGrid', 'communications', 'setup_required',
    'Transactional email, verified senders, delivery events, and suppression health.',
    '/integrations/sendgrid.svg', 'https://www.twilio.com/company/brand',
    'Official Twilio SendGrid brand asset', '#1A82E2', 'https://www.twilio.com/docs/sendgrid', true
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
       array[]::text[], seed.description
from (values
  ('twilio', 'sms.send', 'Send SMS', 'write', 'Send transactional SMS through a verified sender.'),
  ('twilio', 'senders.read', 'Verified senders', 'read', 'Inspect verified sender configuration without exposing credentials.'),
  ('twilio', 'delivery.read', 'SMS delivery', 'read', 'Reconcile message delivery status from provider records and webhooks.'),
  ('sendgrid', 'email.send', 'Send email', 'write', 'Send transactional email through an authenticated sender.'),
  ('sendgrid', 'senders.read', 'Authenticated senders', 'read', 'Inspect authenticated sender health without exposing credentials.'),
  ('sendgrid', 'delivery.read', 'Email delivery', 'read', 'Reconcile delivery events from the signed Event Webhook.'),
  ('sendgrid', 'suppressions.read', 'Suppressions', 'read', 'Read suppression health before attempting delivery.')
) as seed(provider_key, capability_key, display_name, access_mode, description)
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
       'Provider sandbox certification is required before this capability can be enabled for a tenant.'
from public.connector_capabilities capability
join public.connector_registry registry on registry.id = capability.provider_id
where registry.provider_key in ('twilio', 'sendgrid')
on conflict (capability_id, environment, contract_version) do nothing;
