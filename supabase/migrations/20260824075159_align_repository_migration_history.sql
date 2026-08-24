-- The Supabase MCP assigns wall-clock versions when it applies existing
-- repository migrations. Align by stable migration name so the CLI sees the
-- same history and future db push operations remain safe.
update supabase_migrations.schema_migrations migration
set version = expected.version
from (values
  ('setup', '20260722000001'),
  ('tenancy', '20260722000002'),
  ('catalog', '20260722000003'),
  ('customers', '20260722000004'),
  ('orders', '20260722000005'),
  ('campaigns', '20260722000006'),
  ('rls', '20260722000007'),
  ('views', '20260722000008'),
  ('claims_hook', '20260722000009'),
  ('rls_fixes', '20260722000010'),
  ('webhook_idempotency', '20260722000011'),
  ('order_idempotency', '20260722000012'),
  ('realtime_storage_push', '20260722000013'),
  ('table_grants', '20260722000014'),
  ('brand_storefront', '20260722000015'),
  ('service_role_app_schema', '20260722000016'),
  ('square_checkout_url', '20260722000017'),
  ('loyalty_atomicity', '20260722000018'),
  ('brand_terms_are_staff_only', '20260722000019'),
  ('drop_performance_matches_orders', '20260722000020'),
  ('ready_orders_can_be_cancelled', '20260722000021'),
  ('devices', '20260722000022'),
  ('order_number', '20260722000023'),
  ('recipes', '20260722000024'),
  ('shifts', '20260722000025'),
  ('menu_rotation', '20260722000026'),
  ('realtime_menu', '20260722000027'),
  ('curbside_arrival', '20260722000028'),
  ('pack_configuration', '20260722000029'),
  ('loyalty_earn_and_partial_reversals', '20260722000030'),
  ('close_definer_view_writes_and_scope_holes', '20260722000031'),
  ('claim_helpers_answer_false', '20260722000032'),
  ('board_read', '20260722000033'),
  ('close_the_last_view_writes', '20260722000034'),
  ('loyalty_standing', '20260722000035'),
  ('owned_channel_share', '20260722000036'),
  ('kiosk_config_write', '20260722000037'),
  ('device_pairing', '20260722000038'),
  ('per_location_fee_terms', '20260722000039'),
  ('locations_are_not_all_public', '20260722000040'),
  ('kiosk_reads_no_orders', '20260722000041'),
  ('drop_kiosk_receipts', '20260722000042'),
  ('harden_onboarding_and_refunds', '20260824072313')
) as expected(name, version)
where migration.name = expected.name
  and migration.version is distinct from expected.version;
