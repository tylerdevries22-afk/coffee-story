-- Cover every connector foreign-key lookup used by cascades and tenant jobs.
create index connector_dead_letters_brand_fk_idx
  on app_private.connector_dead_letters (brand_id);

create index connector_idempotency_installation_fk_idx
  on app_private.connector_idempotency_keys (installation_id, brand_id);

create index connector_oauth_states_brand_fk_idx
  on app_private.connector_oauth_states (brand_id);
