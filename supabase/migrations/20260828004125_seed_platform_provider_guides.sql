-- Reviewable walkthrough metadata only; secret values never enter this table.
insert into public.platform_provider_guides (
  provider, guide_key, version, title, owner_role, official_url, steps,
  last_verified_at, status
)
values
  ('github', 'repository-factory', 1, 'Install the repository factory', 'platform',
   'https://docs.github.com/en/apps/using-github-apps/about-using-github-apps',
   '["Install the least-privilege GitHub App.","Choose the template organization.","Verify repository creation access."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('doppler', 'secret-environments', 1, 'Create scoped secret environments', 'platform',
   'https://docs.doppler.com/docs/service-tokens',
   '["Create the platform-factory project.","Add dev, preview, and production configs.","Issue one read-only token per runtime."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('supabase', 'hosted-project', 1, 'Authorize hosted project creation', 'platform',
   'https://supabase.com/docs/reference/api/getting-started',
   '["Create a scoped Management API token.","Choose the organization and region.","Verify project and API-key access."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('vercel', 'five-surfaces', 1, 'Authorize five hosted surfaces', 'platform',
   'https://vercel.com/docs/rest-api',
   '["Create a team access token.","Choose the owning team.","Verify project and environment access."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('apple', 'client-store-team', 1, 'Connect the client Apple team', 'account_holder',
   'https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api',
   '["Enroll the client organization.","Invite the release operator.","Create an App Store Connect API key."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('google-play', 'client-store-team', 1, 'Connect the client Play Console', 'account_holder',
   'https://developers.google.com/android-publisher/getting_started',
   '["Create the organization developer account.","Enable the publishing API.","Grant a scoped service account app access."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active'),
  ('expo', 'managed-signing', 1, 'Configure managed build credentials', 'client',
   'https://docs.expo.dev/app-signing/security/',
   '["Create or join the client Expo organization.","Initialize the customer and kiosk projects.","Use managed credentials and verify store submission access."]'::jsonb,
   '2026-08-27T00:00:00Z', 'active')
on conflict (provider, guide_key, version) do update set
  title = excluded.title,
  owner_role = excluded.owner_role,
  official_url = excluded.official_url,
  steps = excluded.steps,
  last_verified_at = excluded.last_verified_at,
  status = excluded.status,
  updated_at = now();
