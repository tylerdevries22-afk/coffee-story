-- Supabase's migration API assigns wall-clock versions. Normalize the four
-- release migrations by stable name so local and hosted histories stay exact.
update supabase_migrations.schema_migrations migration
set version = expected.version
from (values
  ('realtime_surface_signals', '20260824060553'),
  ('brand_settings_and_channel_revenue', '20260824070000'),
  ('customer_account_deletion', '20260824080000'),
  ('release_security_hardening', '20260824100000')
) as expected(name, version)
where migration.name = expected.name
  and migration.version is distinct from expected.version;
