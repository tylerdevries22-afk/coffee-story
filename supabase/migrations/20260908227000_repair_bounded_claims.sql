-- Keep quote retries live without allowing a delayed release to delete a newer
-- reservation, and retain terminal provider evidence after a quote is released.
-- Existing negotiated rates are configuration, so clamp them to Square's
-- documented ceiling. Historical receipts remain immutable: the NOT VALID
-- receipt constraint enforces the new policy for all future writes without
-- rewriting provider evidence accepted under the predecessor contract.
update public.brands set
  fee_bps = least(fee_bps, 9000),
  fee_bps_tier2 = least(fee_bps_tier2, 9000)
where fee_bps > 9000 or fee_bps_tier2 > 9000;
update public.locations set
  fee_bps = case when fee_bps > 9000 then 9000 else fee_bps end,
  fee_bps_tier2 = case when fee_bps_tier2 > 9000 then 9000 else fee_bps_tier2 end
where fee_bps > 9000 or fee_bps_tier2 > 9000;

do $$
begin
  if exists (
    select 1 from public.platform_fee_quotes quote
    where quote.fee_bps_applied not between 0 and 9000
      or quote.fee_cents::numeric * 10 > quote.gross_cents::numeric
        * (case when quote.gross_cents < 500 then 6 else 9 end)
  ) then
    raise exception using errcode = '23514',
      message = 'active_platform_fee_quotes_require_square_limit_reconciliation';
  end if;
  if exists (
    select 1 from public.platform_fees fee where fee.order_id is not null
    group by fee.order_id having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'duplicate_platform_fee_order_receipts_require_reconciliation';
  end if;
end $$;

alter table public.brands
  add constraint brands_square_fee_rate_limit
  check (fee_bps between 0 and 9000 and fee_bps_tier2 between 0 and 9000);
alter table public.locations
  add constraint locations_square_fee_rate_limit
  check ((fee_bps is null or fee_bps between 0 and 9000)
    and (fee_bps_tier2 is null or fee_bps_tier2 between 0 and 9000));
alter table public.platform_fees
  add constraint platform_fees_square_fee_limit
  check (fee_bps_applied between 0 and 9000
    and fee_cents::numeric * 10 <= gross_cents::numeric
      * case when gross_cents < 500 then 6 else 9 end) not valid;
comment on constraint platform_fees_square_fee_limit on public.platform_fees is
  'Enforced for new receipts; legacy immutable provider receipts are retained without validation.';
create unique index platform_fees_order_unique_idx
  on public.platform_fees (order_id) where order_id is not null;

-- Attribute captured volume to the pricing period reserved by the quote, not
-- to the wall-clock instant at which Square's response reached us. Without
-- this stable period, a response delayed across a local month boundary moves
-- the order into the next tier ledger even though its price was already fixed.
alter table public.platform_fees
  add column pricing_month_start timestamptz,
  add column pricing_month_end timestamptz;
update public.platform_fees fee set
  pricing_month_start = pg_catalog.timezone(location.timezone,
    pg_catalog.date_trunc('month',
      pg_catalog.timezone(location.timezone, fee.created_at))),
  pricing_month_end = pg_catalog.timezone(location.timezone,
    pg_catalog.date_trunc('month',
      pg_catalog.timezone(location.timezone, fee.created_at)) + interval '1 month')
from public.locations location
where location.id = fee.location_id;
alter table public.platform_fees
  alter column pricing_month_start set not null,
  alter column pricing_month_end set not null,
  add constraint platform_fees_pricing_month_valid
    check (pricing_month_end > pricing_month_start);
drop index public.platform_fees_location_month_idx;
create index platform_fees_location_month_idx
  on public.platform_fees (location_id, pricing_month_start);

create function app.assign_platform_fee_pricing_month()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  location_timezone text;
begin
  if new.pricing_month_start is null or new.pricing_month_end is null then
    select quote.month_start, quote.month_end
      into new.pricing_month_start, new.pricing_month_end
    from public.platform_fee_quotes quote where quote.order_id = new.order_id;
  end if;
  if new.pricing_month_start is null or new.pricing_month_end is null then
    select location.timezone into location_timezone
    from public.locations location where location.id = new.location_id;
    new.pricing_month_start := pg_catalog.timezone(location_timezone,
      pg_catalog.date_trunc('month', pg_catalog.timezone(
        location_timezone, coalesce(new.created_at, pg_catalog.now()))));
    new.pricing_month_end := pg_catalog.timezone(location_timezone,
      pg_catalog.date_trunc('month', pg_catalog.timezone(
        location_timezone, coalesce(new.created_at, pg_catalog.now()))) + interval '1 month');
  end if;
  return new;
end $$;
revoke all on function app.assign_platform_fee_pricing_month()
  from public, anon, authenticated, service_role;
create trigger assign_platform_fee_pricing_month
before insert on public.platform_fees for each row
execute function app.assign_platform_fee_pricing_month();

-- Tighten the two predecessor configuration writers before adding any new
-- call sites. Preserve their structured validation errors and their ACLs.
do $$
declare
  signature pg_catalog.regprocedure;
  definition text;
  patched text;
begin
  foreach signature in array array[
    'public.set_platform_location_fee_overrides(uuid,uuid,uuid,uuid,integer,integer,bigint)'::regprocedure,
    'public.provision_platform_organization(uuid,text,text,uuid,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb,jsonb,integer,integer,bigint)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(signature);
    patched := pg_catalog.replace(definition,
      'p_fee_bps not between 0 and 10000', 'p_fee_bps not between 0 and 9000');
    patched := pg_catalog.replace(patched,
      'p_fee_bps_tier2 not between 0 and 10000', 'p_fee_bps_tier2 not between 0 and 9000');
    if patched is not distinct from definition then
      raise exception 'platform fee writer boundary was not found for %', signature;
    end if;
    execute patched;
  end loop;
end $$;

create table app_private.square_attempt_terminal_evidence (
  order_id uuid primary key references public.orders (id),
  brand_id uuid not null,
  location_id uuid not null,
  connection_id uuid not null,
  connection_generation uuid not null,
  tender_type text not null check (tender_type in ('square_card', 'square_link')),
  square_order_id text not null unique,
  square_payment_link_id text,
  square_payment_id text,
  payment_idempotency_key text,
  quote_claim_generation uuid not null,
  pricing_month_start timestamptz not null,
  pricing_month_end timestamptz not null,
  gross_cents bigint not null check (gross_cents > 0),
  fee_cents bigint not null check (fee_cents >= 0
    and fee_cents::numeric * 10 <= gross_cents::numeric
      * case when gross_cents < 500 then 6 else 9 end),
  fee_bps_applied integer not null check (fee_bps_applied between 0 and 9000),
  provider_order_version bigint not null check (provider_order_version >= 0),
  provider_order_state text not null check (provider_order_state = 'CANCELED'),
  provider_payment_state text check (provider_payment_state in ('CANCELED', 'FAILED')),
  terminal_reason text not null check (terminal_reason in (
    'hosted_checkout_expired', 'card_attempt_expired', 'card_payment_terminal'
  )),
  recorded_at timestamptz not null default now(),
  connection_guard_until timestamptz not null default now() + interval '25 hours',
  check ((square_payment_id is null) = (provider_payment_state is null)),
  check ((tender_type = 'square_link') = (square_payment_link_id is not null)),
  check (tender_type <> 'square_link' or square_order_id is not null),
  check ((tender_type = 'square_card') = (payment_idempotency_key is not null)),
  check (connection_guard_until >= recorded_at + interval '24 hours'
    and connection_guard_until <= recorded_at + interval '48 hours'),
  check (pricing_month_end > pricing_month_start)
);
create unique index square_attempt_terminal_payment_idx
  on app_private.square_attempt_terminal_evidence (square_payment_id)
  where square_payment_id is not null;
create unique index square_attempt_terminal_link_idx
  on app_private.square_attempt_terminal_evidence (square_payment_link_id)
  where square_payment_link_id is not null;
create index square_attempt_terminal_location_idx
  on app_private.square_attempt_terminal_evidence (location_id, recorded_at desc);
alter table app_private.square_attempt_terminal_evidence enable row level security;
revoke all on table app_private.square_attempt_terminal_evidence
  from public, anon, authenticated, service_role;

-- A provider payment can complete after its exact order was cancelled. Retain
-- the collected-money receipt and lease a deterministic full refund instead of
-- acknowledging the webhook while leaving the charge orphaned.
create table app_private.square_payment_remediation_outbox (
  order_id uuid primary key references public.orders (id),
  brand_id uuid not null,
  location_id uuid not null,
  connection_id uuid not null,
  connection_generation uuid not null,
  square_order_id text not null unique,
  square_payment_id text not null unique,
  settlement_event_id text not null unique,
  refund_amount_cents bigint not null check (refund_amount_cents > 0),
  refund_request_key uuid not null unique,
  square_refund_id text unique,
  provider_refund_status text
    check (provider_refund_status in ('PENDING', 'COMPLETED', 'REJECTED', 'FAILED')),
  provider_refund_payment_id text,
  provider_refund_amount_cents bigint,
  provider_refund_currency text,
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'submitted', 'failed', 'completed',
      'manual_action_required'
    )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  poll_attempt_count bigint not null default 0 check (poll_attempt_count >= 0),
  available_at timestamptz not null default now(),
  submitted_at timestamptz,
  claimed_at timestamptz,
  claim_generation uuid,
  last_error_code text,
  completed_at timestamptz,
  manual_action_required_at timestamptz,
  created_at timestamptz not null default now(),
  check ((square_refund_id is null) = (provider_refund_status is null)
    and (square_refund_id is null) = (provider_refund_payment_id is null)
    and (square_refund_id is null) = (provider_refund_amount_cents is null)
    and (square_refund_id is null) = (provider_refund_currency is null)),
  check ((square_refund_id is null) = (submitted_at is null)),
  check (provider_refund_payment_id is null
    or provider_refund_payment_id = square_payment_id),
  check (provider_refund_amount_cents is null
    or provider_refund_amount_cents = refund_amount_cents),
  check (provider_refund_currency is null or provider_refund_currency = 'USD'),
  check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  check (status <> 'processing' or (claimed_at is not null and claim_generation is not null)),
  check (status = 'processing' or claimed_at is null),
  check (status <> 'submitted'
    or coalesce(provider_refund_status = 'PENDING', false)),
  check (status <> 'completed' or (
    coalesce(provider_refund_status = 'COMPLETED', false)
    and completed_at is not null and manual_action_required_at is null
  )),
  check (status <> 'manual_action_required' or (
    manual_action_required_at is not null and completed_at is null
    and (provider_refund_status in ('REJECTED', 'FAILED')
      or (provider_refund_status is null and attempt_count = 20))
  ))
);
create index square_payment_remediation_due_idx
  on app_private.square_payment_remediation_outbox (available_at, order_id)
  where status in ('pending', 'processing', 'submitted', 'failed');
create index square_payment_remediation_location_idx
  on app_private.square_payment_remediation_outbox (location_id, created_at desc);
alter table app_private.square_payment_remediation_outbox enable row level security;
revoke all on table app_private.square_payment_remediation_outbox
  from public, anon, authenticated, service_role;

-- A signed COMPLETED delivery can prove that money moved while still being
-- unsafe to map to local accounting. Keep that raw delivery in webhook_events
-- and open a structured alert instead of guessing an order or refund intent.
create table app_private.square_payment_validation_alerts (
  event_id text primary key references public.webhook_events (event_id),
  error_code text not null check (error_code in (
    'payment_event_invalid', 'payment_amount_invalid', 'payment_fee_invalid',
    'payment_location_invalid', 'payment_order_binding_invalid',
    'payment_settlement_conflict'
  )),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_code text check (
    resolution_code is null or resolution_code ~ '^[a-z0-9_]{1,64}$'
  ),
  evidence_reference text check (
    evidence_reference is null or (
      pg_catalog.octet_length(evidence_reference) between 3 and 255
      and evidence_reference !~ '[[:cntrl:]]'
    )
  ),
  check ((resolved_at is null) = (resolution_code is null)
    and (resolved_at is null) = (evidence_reference is null))
);
create index square_payment_validation_alerts_open_idx
  on app_private.square_payment_validation_alerts (detected_at, event_id)
  where resolved_at is null;
alter table app_private.square_payment_validation_alerts enable row level security;
revoke all on table app_private.square_payment_validation_alerts
  from public, anon, authenticated, service_role;

-- Disconnect and reconnect span a provider call, while quote reservation is a
-- database transaction. A durable per-location fence closes that boundary:
-- once a mutation claim is admitted, no new payment quote can start until the
-- exact claimant either finalizes or records a definitive pre-provider failure.
create table app_private.square_connection_mutation_fences (
  location_id uuid primary key references public.locations (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  mutation_generation uuid,
  mutation_kind text check (mutation_kind in ('disconnect', 'replace', 'renew')),
  expected_connection_id uuid,
  expected_connection_generation uuid,
  expected_access_token_encrypted text,
  expected_refresh_token_encrypted text,
  claimed_at timestamptz,
  finished_generation uuid,
  finished_kind text check (finished_kind in ('disconnect', 'replace', 'renew')),
  finished_outcome text check (finished_outcome in ('completed', 'failed')),
  finished_connection_id uuid,
  finished_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  check ((mutation_generation is null) = (mutation_kind is null)
    and (mutation_generation is null) = (claimed_at is null)),
  check ((finished_generation is null) = (finished_kind is null)
    and (finished_generation is null) = (finished_outcome is null)
    and (finished_generation is null) = (finished_at is null))
);
create index square_connection_mutation_alert_idx
  on app_private.square_connection_mutation_fences (claimed_at, location_id)
  where mutation_generation is not null;
alter table app_private.square_connection_mutation_fences enable row level security;
revoke all on table app_private.square_connection_mutation_fences
  from public, anon, authenticated, service_role;

alter table public.square_connections
  add column connection_generation uuid not null default gen_random_uuid();
create unique index square_connections_generation_idx
  on public.square_connections (connection_generation);

alter table public.platform_fee_quotes
  add column connection_id uuid,
  add column connection_generation uuid;
update public.platform_fee_quotes quote set
  connection_id = connection.id,
  connection_generation = connection.connection_generation
from public.square_connections connection
where connection.location_id = quote.location_id;
do $$
begin
  if exists (select 1 from public.platform_fee_quotes quote
    where quote.connection_id is null or quote.connection_generation is null) then
    raise exception using errcode = '55000',
      message = 'active_platform_fee_quotes_require_connection_reconciliation';
  end if;
end $$;
alter table public.platform_fee_quotes
  alter column connection_id set not null,
  alter column connection_generation set not null,
  add constraint platform_fee_quotes_connection_id_fkey
    foreign key (connection_id) references public.square_connections (id),
  add constraint platform_fee_quotes_connection_generation_fkey
    foreign key (connection_generation)
    references public.square_connections (connection_generation) on update cascade;

create function app.guard_square_connection_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fence_generation uuid;
  admitted_generation text;
  rpc_admitted boolean;
begin
  select fence.mutation_generation into fence_generation
  from app_private.square_connection_mutation_fences fence
  where fence.location_id = coalesce(new.location_id, old.location_id);
  admitted_generation := pg_catalog.current_setting(
    'app.square_connection_mutation_generation', true);
  rpc_admitted := fence_generation is not null
    and admitted_generation = fence_generation::text;
  if fence_generation is not null and not rpc_admitted then
    raise exception using errcode = '55000',
      message = 'square_connection_transition_in_progress';
  end if;
  if tg_op = 'UPDATE' and not rpc_admitted then
    if new.brand_id is distinct from old.brand_id
      or new.location_id is distinct from old.location_id then
      raise exception using errcode = '22023',
        message = 'square_connection_mutation_invalid';
    end if;
    if new.access_token_encrypted is distinct from old.access_token_encrypted
      or new.refresh_token_encrypted is distinct from old.refresh_token_encrypted
      or new.merchant_id is distinct from old.merchant_id
      or new.square_location_id is distinct from old.square_location_id then
      if exists (select 1 from public.platform_fee_quotes quote
          where quote.location_id = old.location_id)
        or exists (select 1 from app_private.square_payment_remediation_outbox queued
          where queued.location_id = old.location_id and queued.status <> 'completed')
        or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
          where terminal.location_id = old.location_id
            and terminal.connection_guard_until > pg_catalog.now()) then
        raise exception using errcode = '55000',
          message = 'square_connection_has_active_payment_state';
      end if;
      new.connection_generation := gen_random_uuid();
    elsif new.connection_generation is distinct from old.connection_generation then
      raise exception using errcode = '22023',
        message = 'square_connection_mutation_invalid';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function app.guard_square_connection_mutation()
  from public, anon, authenticated, service_role;
create trigger guard_square_connection_mutation
before insert or update or delete on public.square_connections
for each row execute function app.guard_square_connection_mutation();

create function public.claim_square_connection_mutation(
  p_brand_id uuid,
  p_location_id uuid,
  p_mutation_generation uuid,
  p_mutation_kind text,
  p_expected_connection_id uuid,
  p_expected_connection_generation uuid,
  p_expected_access_token_encrypted text,
  p_expected_refresh_token_encrypted text
)
returns table (
  mutation_generation uuid,
  mutation_state text,
  mutation_claim_created boolean,
  connection_id uuid,
  connection_generation uuid,
  access_token_encrypted text,
  refresh_token_encrypted text
)
language plpgsql security definer set search_path = '' as $$
declare
  fence app_private.square_connection_mutation_fences%rowtype;
  current_connection public.square_connections%rowtype;
begin
  if p_brand_id is null or p_location_id is null or p_mutation_generation is null
    or p_mutation_kind not in ('disconnect', 'replace', 'renew')
    or ((p_expected_connection_id is null
      or p_expected_connection_generation is null
      or p_expected_access_token_encrypted is null
      or p_expected_refresh_token_encrypted is null) and not (
        p_mutation_kind = 'replace' and p_expected_connection_id is null
        and p_expected_connection_generation is null
        and p_expected_access_token_encrypted is null
        and p_expected_refresh_token_encrypted is null
      ))
    or (p_expected_access_token_encrypted is not null and (
      pg_catalog.octet_length(p_expected_access_token_encrypted) not between 8 and 32768
      or p_expected_access_token_encrypted ~ '[[:space:]]'))
    or (p_expected_refresh_token_encrypted is not null and (
      pg_catalog.octet_length(p_expected_refresh_token_encrypted) not between 8 and 32768
      or p_expected_refresh_token_encrypted ~ '[[:space:]]')) then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  insert into app_private.square_connection_mutation_fences (location_id, brand_id)
  select location.id, location.brand_id from public.locations location
  where location.id = p_location_id and location.brand_id = p_brand_id
  on conflict (location_id) do nothing;
  select candidate.* into fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  if fence.location_id is null or fence.brand_id is distinct from p_brand_id then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  select candidate.* into current_connection from public.square_connections candidate
  where candidate.location_id = p_location_id for update;
  if fence.finished_generation = p_mutation_generation
    and fence.finished_kind = p_mutation_kind then
    if fence.expected_connection_id is distinct from p_expected_connection_id
      or fence.expected_connection_generation is distinct from
        p_expected_connection_generation
      or fence.expected_access_token_encrypted is distinct from
        p_expected_access_token_encrypted
      or fence.expected_refresh_token_encrypted is distinct from
        p_expected_refresh_token_encrypted then
      raise exception using errcode = '55000', message = 'square_connection_changed';
    end if;
    mutation_generation := p_mutation_generation;
    mutation_state := fence.finished_outcome;
    mutation_claim_created := false;
    connection_id := current_connection.id;
    connection_generation := current_connection.connection_generation;
    access_token_encrypted := current_connection.access_token_encrypted;
    refresh_token_encrypted := current_connection.refresh_token_encrypted;
    return next;
    return;
  end if;
  if fence.mutation_generation is not null then
    if fence.mutation_generation = p_mutation_generation
      and fence.mutation_kind = p_mutation_kind
      and fence.expected_connection_id is not distinct from p_expected_connection_id
      and fence.expected_connection_generation is not distinct from
        p_expected_connection_generation
      and fence.expected_access_token_encrypted is not distinct from
        p_expected_access_token_encrypted
      and fence.expected_refresh_token_encrypted is not distinct from
        p_expected_refresh_token_encrypted then
      mutation_generation := p_mutation_generation;
      mutation_state := 'claimed';
      mutation_claim_created := false;
      connection_id := current_connection.id;
      connection_generation := current_connection.connection_generation;
      access_token_encrypted := current_connection.access_token_encrypted;
      refresh_token_encrypted := current_connection.refresh_token_encrypted;
      return next;
      return;
    end if;
    raise exception using errcode = '55000',
      message = 'square_connection_transition_in_progress';
  end if;
  if current_connection.id is null then
    if p_mutation_kind = 'disconnect' then
      raise exception using errcode = '55000', message = 'square_connection_not_connected';
    end if;
    if p_expected_connection_id is not null then
      raise exception using errcode = '55000', message = 'square_connection_changed';
    end if;
  elsif current_connection.brand_id is distinct from p_brand_id
    or current_connection.id is distinct from p_expected_connection_id
    or current_connection.connection_generation is distinct from
      p_expected_connection_generation
    or current_connection.access_token_encrypted is distinct from
      p_expected_access_token_encrypted
    or current_connection.refresh_token_encrypted is distinct from
      p_expected_refresh_token_encrypted then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  if exists (select 1 from public.platform_fee_quotes quote
      where quote.location_id = p_location_id
        and quote.cleanup_claimed_at > pg_catalog.now() - interval '5 minutes')
    or exists (select 1 from app_private.square_payment_remediation_outbox queued
      where queued.location_id = p_location_id and queued.status = 'processing'
        and queued.available_at > pg_catalog.now()) then
    raise exception using errcode = '55000',
      message = 'square_connection_provider_operation_in_progress';
  end if;
  if p_mutation_kind = 'disconnect' and (
    exists (select 1 from public.platform_fee_quotes quote
      where quote.location_id = p_location_id)
    or exists (select 1 from app_private.square_payment_remediation_outbox queued
      where queued.location_id = p_location_id and queued.status <> 'completed')
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.location_id = p_location_id
        and terminal.connection_guard_until > pg_catalog.now())
  ) then
    raise exception using errcode = '55000',
      message = 'square_connection_has_active_payment_state';
  end if;
  update app_private.square_connection_mutation_fences candidate set
    mutation_generation = p_mutation_generation,
    mutation_kind = p_mutation_kind,
    expected_connection_id = p_expected_connection_id,
    expected_connection_generation = p_expected_connection_generation,
    expected_access_token_encrypted = p_expected_access_token_encrypted,
    expected_refresh_token_encrypted = p_expected_refresh_token_encrypted,
    claimed_at = pg_catalog.now(),
    last_error_code = null
  where candidate.location_id = p_location_id;
  if p_mutation_kind = 'renew' then
    perform pg_catalog.set_config('app.square_connection_mutation_generation',
      p_mutation_generation::text, true);
    update public.square_connections candidate set updated_at = pg_catalog.now()
    where candidate.id = current_connection.id
      and candidate.connection_generation = current_connection.connection_generation;
  end if;
  mutation_generation := p_mutation_generation;
  mutation_state := 'claimed';
  mutation_claim_created := true;
  connection_id := current_connection.id;
  connection_generation := current_connection.connection_generation;
  access_token_encrypted := current_connection.access_token_encrypted;
  refresh_token_encrypted := current_connection.refresh_token_encrypted;
  return next;
end $$;

create function public.finalize_square_connection_replacement(
  p_brand_id uuid,
  p_location_id uuid,
  p_mutation_generation uuid,
  p_expected_connection_id uuid,
  p_expected_connection_generation uuid,
  p_merchant_id text,
  p_square_location_id text,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_expires_at timestamptz,
  p_oauth_scope_contract_version integer
)
returns table (connection_id uuid, connection_generation uuid)
language plpgsql security definer set search_path = '' as $$
declare
  fence app_private.square_connection_mutation_fences%rowtype;
  current_connection public.square_connections%rowtype;
  stored_connection_id uuid;
  stored_generation uuid := gen_random_uuid();
  stored_scope_matches boolean;
begin
  if p_brand_id is null or p_location_id is null or p_mutation_generation is null
    or p_merchant_id is null or p_square_location_id is null
    or p_access_token_encrypted is null or p_refresh_token_encrypted is null
    or p_expires_at is null or p_oauth_scope_contract_version is null
    or p_oauth_scope_contract_version <= 0
    or pg_catalog.octet_length(p_merchant_id) not between 1 and 255
    or pg_catalog.octet_length(p_square_location_id) not between 1 and 255
    or pg_catalog.octet_length(p_access_token_encrypted) not between 8 and 32768
    or pg_catalog.octet_length(p_refresh_token_encrypted) not between 8 and 32768
    or p_merchant_id ~ '[[:space:]]' or p_square_location_id ~ '[[:space:]]'
    or p_access_token_encrypted ~ '[[:space:]]'
    or p_refresh_token_encrypted ~ '[[:space:]]' then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  select candidate.* into fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  select candidate.* into current_connection from public.square_connections candidate
  where candidate.location_id = p_location_id for update;
  if fence.finished_generation = p_mutation_generation
    and fence.finished_kind = 'replace' and fence.finished_outcome = 'completed' then
    if fence.brand_id is distinct from p_brand_id
      or fence.expected_connection_id is distinct from p_expected_connection_id
      or fence.expected_connection_generation is distinct from
        p_expected_connection_generation
      or current_connection.id is null
      or current_connection.id is distinct from fence.finished_connection_id
      or current_connection.brand_id is distinct from p_brand_id
      or current_connection.merchant_id is distinct from p_merchant_id
      or current_connection.square_location_id is distinct from p_square_location_id
      or current_connection.access_token_encrypted is distinct from p_access_token_encrypted
      or current_connection.refresh_token_encrypted is distinct from p_refresh_token_encrypted
      or current_connection.expires_at is distinct from p_expires_at then
      raise exception using errcode = '55000', message = 'square_connection_changed';
    end if;
    execute 'select oauth_scope_contract_version = $1 from public.square_connections where id = $2'
      into stored_scope_matches
      using p_oauth_scope_contract_version, current_connection.id;
    if not coalesce(stored_scope_matches, false) then
      raise exception using errcode = '55000', message = 'square_connection_changed';
    end if;
    connection_id := current_connection.id;
    connection_generation := current_connection.connection_generation;
    return next;
    return;
  end if;
  if fence.location_id is null or fence.brand_id is distinct from p_brand_id
    or fence.mutation_generation is distinct from p_mutation_generation
    or fence.mutation_kind is distinct from 'replace'
    or fence.expected_connection_id is distinct from p_expected_connection_id
    or fence.expected_connection_generation is distinct from
      p_expected_connection_generation then
    raise exception using errcode = '55000',
      message = 'square_connection_transition_in_progress';
  end if;
  if (current_connection.id is null) is distinct from (p_expected_connection_id is null)
    or current_connection.id is distinct from p_expected_connection_id
    or current_connection.connection_generation is distinct from
      p_expected_connection_generation
    or current_connection.access_token_encrypted is distinct from
      fence.expected_access_token_encrypted
    or current_connection.refresh_token_encrypted is distinct from
      fence.expected_refresh_token_encrypted then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  if (
    exists (select 1 from public.platform_fee_quotes quote
      where quote.location_id = p_location_id)
    or exists (select 1 from app_private.square_payment_remediation_outbox queued
      where queued.location_id = p_location_id and queued.status <> 'completed')
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.location_id = p_location_id
        and terminal.connection_guard_until > pg_catalog.now())
  ) and (current_connection.id is null
    or p_merchant_id is distinct from current_connection.merchant_id
    or p_square_location_id is distinct from current_connection.square_location_id) then
    raise exception using errcode = '55000',
      message = 'square_connection_has_active_payment_state';
  end if;
  perform pg_catalog.set_config('app.square_connection_mutation_generation',
    p_mutation_generation::text, true);
  if current_connection.id is null then
    execute $statement$
      insert into public.square_connections (
        brand_id, location_id, merchant_id, square_location_id,
        access_token_encrypted, refresh_token_encrypted, expires_at,
        oauth_scope_contract_version, connection_generation
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      returning id
    $statement$ into stored_connection_id using
      p_brand_id, p_location_id, p_merchant_id, p_square_location_id,
      p_access_token_encrypted, p_refresh_token_encrypted, p_expires_at,
      p_oauth_scope_contract_version, stored_generation;
  else
    execute $statement$
      update public.square_connections set
        merchant_id = $1, square_location_id = $2,
        access_token_encrypted = $3, refresh_token_encrypted = $4,
        expires_at = $5, oauth_scope_contract_version = $6,
        connection_generation = $7
      where id = $8 returning id
    $statement$ into stored_connection_id using
      p_merchant_id, p_square_location_id, p_access_token_encrypted,
      p_refresh_token_encrypted, p_expires_at, p_oauth_scope_contract_version,
      stored_generation, current_connection.id;
  end if;
  if stored_connection_id is null then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  update app_private.square_attempt_terminal_evidence terminal set
    connection_generation = stored_generation
  where terminal.connection_id = stored_connection_id
    and terminal.connection_guard_until > pg_catalog.now();
  update app_private.square_payment_remediation_outbox queued set
    connection_generation = stored_generation
  where queued.connection_id = stored_connection_id
    and queued.status <> 'completed';
  update public.locations set square_connection_id = stored_connection_id
  where id = p_location_id and brand_id = p_brand_id;
  update app_private.square_connection_mutation_fences candidate set
    finished_generation = p_mutation_generation,
    finished_kind = 'replace', finished_outcome = 'completed',
    finished_connection_id = stored_connection_id, finished_at = pg_catalog.now(),
    mutation_generation = null, mutation_kind = null,
    claimed_at = null,
    last_error_code = null
  where candidate.location_id = p_location_id;
  connection_id := stored_connection_id;
  connection_generation := stored_generation;
  return next;
end $$;

create function public.finalize_square_connection_renewal(
  p_brand_id uuid,
  p_location_id uuid,
  p_mutation_generation uuid,
  p_expected_connection_id uuid,
  p_expected_connection_generation uuid,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_expires_at timestamptz
)
returns table (connection_id uuid, connection_generation uuid)
language plpgsql security definer set search_path = '' as $$
declare
  fence app_private.square_connection_mutation_fences%rowtype;
  current_connection public.square_connections%rowtype;
  stored_generation uuid := gen_random_uuid();
begin
  if p_brand_id is null or p_location_id is null or p_mutation_generation is null
    or p_expected_connection_id is null or p_expected_connection_generation is null
    or p_access_token_encrypted is null or p_refresh_token_encrypted is null
    or p_expires_at is null
    or pg_catalog.octet_length(p_access_token_encrypted) not between 8 and 32768
    or pg_catalog.octet_length(p_refresh_token_encrypted) not between 8 and 32768
    or p_access_token_encrypted ~ '[[:space:]]'
    or p_refresh_token_encrypted ~ '[[:space:]]' then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  select candidate.* into fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  select candidate.* into current_connection
  from public.square_connections candidate
  where candidate.location_id = p_location_id for update;
  if fence.finished_generation = p_mutation_generation
    and fence.finished_kind = 'renew' and fence.finished_outcome = 'completed' then
    if fence.brand_id is distinct from p_brand_id
      or fence.expected_connection_id is distinct from p_expected_connection_id
      or fence.expected_connection_generation is distinct from
        p_expected_connection_generation
      or current_connection.id is distinct from p_expected_connection_id
      or current_connection.access_token_encrypted is distinct from
        p_access_token_encrypted
      or current_connection.refresh_token_encrypted is distinct from
        p_refresh_token_encrypted
      or current_connection.expires_at is distinct from p_expires_at then
      raise exception using errcode = '55000', message = 'square_connection_changed';
    end if;
    connection_id := current_connection.id;
    connection_generation := current_connection.connection_generation;
    return next;
    return;
  end if;
  if fence.location_id is null or fence.brand_id is distinct from p_brand_id
    or fence.mutation_generation is distinct from p_mutation_generation
    or fence.mutation_kind is distinct from 'renew'
    or fence.expected_connection_id is distinct from p_expected_connection_id
    or fence.expected_connection_generation is distinct from
      p_expected_connection_generation
    or current_connection.id is distinct from p_expected_connection_id
    or current_connection.connection_generation is distinct from
      p_expected_connection_generation
    or current_connection.access_token_encrypted is distinct from
      fence.expected_access_token_encrypted
    or current_connection.refresh_token_encrypted is distinct from
      fence.expected_refresh_token_encrypted then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  perform pg_catalog.set_config('app.square_connection_mutation_generation',
    p_mutation_generation::text, true);
  update public.square_connections candidate set
    access_token_encrypted = p_access_token_encrypted,
    refresh_token_encrypted = p_refresh_token_encrypted,
    expires_at = p_expires_at,
    connection_generation = stored_generation
  where candidate.id = p_expected_connection_id
    and candidate.connection_generation = p_expected_connection_generation;
  if not found then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  update app_private.square_attempt_terminal_evidence terminal set
    connection_generation = stored_generation
  where terminal.connection_id = p_expected_connection_id
    and terminal.connection_guard_until > pg_catalog.now();
  update app_private.square_payment_remediation_outbox queued set
    connection_generation = stored_generation
  where queued.connection_id = p_expected_connection_id
    and queued.status <> 'completed';
  update app_private.square_connection_mutation_fences candidate set
    finished_generation = p_mutation_generation,
    finished_kind = 'renew', finished_outcome = 'completed',
    finished_connection_id = p_expected_connection_id,
    finished_at = pg_catalog.now(), last_error_code = null,
    mutation_generation = null, mutation_kind = null, claimed_at = null
  where candidate.location_id = p_location_id;
  connection_id := p_expected_connection_id;
  connection_generation := stored_generation;
  return next;
end $$;

create function public.finalize_square_connection_disconnect(
  p_brand_id uuid,
  p_location_id uuid,
  p_mutation_generation uuid,
  p_expected_connection_id uuid,
  p_expected_connection_generation uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  fence app_private.square_connection_mutation_fences%rowtype;
  current_connection public.square_connections%rowtype;
begin
  if p_brand_id is null or p_location_id is null or p_mutation_generation is null
    or p_expected_connection_id is null or p_expected_connection_generation is null then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  select candidate.* into fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  if fence.finished_generation = p_mutation_generation
    and fence.finished_kind = 'disconnect' and fence.finished_outcome = 'completed' then
    return fence.brand_id = p_brand_id
      and fence.expected_connection_id = p_expected_connection_id
      and fence.expected_connection_generation = p_expected_connection_generation;
  end if;
  if fence.location_id is null or fence.brand_id is distinct from p_brand_id
    or fence.mutation_generation is distinct from p_mutation_generation
    or fence.mutation_kind is distinct from 'disconnect'
    or fence.expected_connection_id is distinct from p_expected_connection_id
    or fence.expected_connection_generation is distinct from
      p_expected_connection_generation then
    return false;
  end if;
  select candidate.* into current_connection from public.square_connections candidate
  where candidate.location_id = p_location_id for update;
  if current_connection.id is distinct from p_expected_connection_id
    or current_connection.connection_generation is distinct from
      p_expected_connection_generation
    or current_connection.access_token_encrypted is distinct from
      fence.expected_access_token_encrypted
    or current_connection.refresh_token_encrypted is distinct from
      fence.expected_refresh_token_encrypted then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  if exists (select 1 from public.platform_fee_quotes quote
      where quote.location_id = p_location_id)
    or exists (select 1 from app_private.square_payment_remediation_outbox queued
      where queued.location_id = p_location_id and queued.status <> 'completed')
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.location_id = p_location_id
        and terminal.connection_guard_until > pg_catalog.now()) then
    raise exception using errcode = '55000',
      message = 'square_connection_has_active_payment_state';
  end if;
  perform pg_catalog.set_config('app.square_connection_mutation_generation',
    p_mutation_generation::text, true);
  delete from public.square_connections candidate
  where candidate.id = current_connection.id
    and candidate.connection_generation = current_connection.connection_generation;
  if not found then return false; end if;
  update app_private.square_connection_mutation_fences candidate set
    finished_generation = p_mutation_generation,
    finished_kind = 'disconnect', finished_outcome = 'completed',
    finished_connection_id = current_connection.id, finished_at = pg_catalog.now(),
    mutation_generation = null, mutation_kind = null,
    claimed_at = null,
    last_error_code = null
  where candidate.location_id = p_location_id;
  return true;
end $$;

create function public.fail_square_connection_mutation(
  p_brand_id uuid,
  p_location_id uuid,
  p_mutation_generation uuid,
  p_error_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  fence app_private.square_connection_mutation_fences%rowtype;
begin
  if p_brand_id is null or p_location_id is null or p_mutation_generation is null
    or p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception using errcode = '22023', message = 'square_connection_mutation_invalid';
  end if;
  select candidate.* into fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  if fence.location_id is null or fence.brand_id is distinct from p_brand_id then
    return false;
  end if;
  if fence.finished_generation = p_mutation_generation
    and fence.finished_outcome = 'failed'
    and fence.last_error_code = p_error_code then return true; end if;
  if fence.mutation_generation is distinct from p_mutation_generation then
    return false;
  end if;
  update app_private.square_connection_mutation_fences candidate set
    finished_generation = p_mutation_generation,
    finished_kind = candidate.mutation_kind, finished_outcome = 'failed',
    finished_connection_id = candidate.expected_connection_id,
    finished_at = pg_catalog.now(), last_error_code = p_error_code,
    mutation_generation = null, mutation_kind = null,
    claimed_at = null
  where candidate.location_id = p_location_id;
  return true;
end $$;

create function public.count_square_connection_mutation_alerts()
returns bigint language sql stable security definer set search_path = '' as $$
  select pg_catalog.count(*)
  from app_private.square_connection_mutation_fences fence
  where fence.mutation_generation is not null
    and fence.claimed_at <= pg_catalog.now() - interval '5 minutes'
$$;

alter table public.platform_fee_quotes
  add column claim_generation uuid not null default gen_random_uuid();
alter table public.platform_fee_quotes
  add constraint platform_fee_quotes_square_fee_limit
  check (fee_bps_applied between 0 and 9000
    and fee_cents::numeric * 10 <= gross_cents::numeric
      * case when gross_cents < 500 then 6 else 9 end);

drop function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz
);

create function public.claim_platform_fee_quote(
  p_order_id uuid,
  p_location_id uuid,
  p_charge_cents bigint,
  p_fee_bps integer,
  p_fee_bps_tier2 integer,
  p_tier_threshold_cents bigint,
  p_month_start timestamptz,
  p_month_end timestamptz,
  p_connection_id uuid,
  p_connection_generation uuid,
  p_require_existing boolean default false
)
returns table (
  quoted_fee_cents bigint,
  quoted_fee_bps_applied integer,
  quote_claim_generation uuid,
  quote_claim_created boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  order_row public.orders%rowtype;
  existing public.platform_fee_quotes%rowtype;
  month_gross bigint;
  below_cents bigint;
  calculated_fee bigint;
  configured_fee_bps integer;
  configured_fee_bps_tier2 integer;
  configured_threshold bigint;
  location_timezone text;
  canonical_month_start timestamptz;
  canonical_month_end timestamptz;
  connection_fence app_private.square_connection_mutation_fences%rowtype;
  payment_connection public.square_connections%rowtype;
begin
  if p_order_id is null or p_location_id is null or p_charge_cents is null
    or p_fee_bps is null or p_fee_bps_tier2 is null
    or p_tier_threshold_cents is null or p_month_start is null or p_month_end is null
    or p_connection_id is null or p_connection_generation is null
    or p_require_existing is null
    or p_charge_cents <= 0 or p_fee_bps not between 0 and 9000
    or p_fee_bps_tier2 not between 0 and 9000
    or p_tier_threshold_cents < 0 or p_month_end <= p_month_start then
    raise exception 'invalid platform fee quote inputs';
  end if;
  insert into app_private.square_connection_mutation_fences (location_id, brand_id)
  select location.id, location.brand_id from public.locations location
  where location.id = p_location_id
  on conflict (location_id) do nothing;
  select candidate.* into connection_fence
  from app_private.square_connection_mutation_fences candidate
  where candidate.location_id = p_location_id for update;
  if connection_fence.location_id is null then
    raise exception 'invalid platform fee quote inputs';
  end if;
  if connection_fence.mutation_generation is not null then
    raise exception using errcode = '55000',
      message = 'square_connection_transition_in_progress';
  end if;
  select candidate.* into payment_connection from public.square_connections candidate
  where candidate.id = p_connection_id and candidate.location_id = p_location_id
  for share;
  if payment_connection.id is null
    or payment_connection.connection_generation is distinct from
      p_connection_generation then
    raise exception using errcode = '55000', message = 'square_connection_changed';
  end if;
  select coalesce(location.fee_bps, brand.fee_bps),
    coalesce(location.fee_bps_tier2, brand.fee_bps_tier2),
    coalesce(location.tier_threshold_cents, brand.tier_threshold_cents),
    location.timezone
  into configured_fee_bps, configured_fee_bps_tier2, configured_threshold,
    location_timezone
  from public.locations location
  join public.brands brand on brand.id = location.brand_id
  where location.id = p_location_id
  for share of location, brand;
  if not found then raise exception 'invalid platform fee quote inputs'; end if;
  canonical_month_start := pg_catalog.timezone(location_timezone,
    pg_catalog.date_trunc('month',
      pg_catalog.timezone(location_timezone, pg_catalog.now())));
  canonical_month_end := pg_catalog.timezone(location_timezone,
    pg_catalog.date_trunc('month',
      pg_catalog.timezone(location_timezone, pg_catalog.now())) + interval '1 month');
  if p_fee_bps is distinct from configured_fee_bps
    or p_fee_bps_tier2 is distinct from configured_fee_bps_tier2
    or p_tier_threshold_cents is distinct from configured_threshold
    or p_month_start is distinct from canonical_month_start
    or p_month_end is distinct from canonical_month_end then
    raise exception 'platform fee quote inputs do not match configured terms';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || p_location_id::text || ':'
      || pg_catalog.date_part('epoch', p_month_start)::text, 0
  ));
  select * into order_row from public.orders where id = p_order_id for update;
  if order_row.id is null or order_row.status <> 'created'
    or order_row.tender_type not in ('square_card', 'square_link')
    or order_row.location_id is distinct from p_location_id
    or order_row.total_cents - order_row.stored_value_applied_cents is distinct from p_charge_cents
    or order_row.square_payment_id is not null
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id)
    or exists (select 1 from public.platform_fees fee
      where fee.order_id = p_order_id) then
    raise exception 'order does not match platform fee quote';
  end if;
  select * into existing from public.platform_fee_quotes
  where order_id = p_order_id for update;
  if existing.order_id is not null then
    if existing.location_id is distinct from p_location_id
      or existing.connection_id is distinct from p_connection_id
      or existing.connection_generation is distinct from p_connection_generation
      or existing.month_start is distinct from p_month_start
      or existing.month_end is distinct from p_month_end
      or existing.gross_cents is distinct from p_charge_cents
      or existing.cleanup_claimed_at is not null
      or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id) then
      raise exception 'existing platform fee quote does not match request';
    end if;
    if existing.expires_at <= pg_catalog.now() then
      update public.platform_fee_quotes quote set
        expires_at = least(p_month_end, pg_catalog.now() + interval '1 hour'),
        claim_generation = gen_random_uuid()
      where quote.order_id = p_order_id
      returning quote.fee_cents, quote.fee_bps_applied, quote.claim_generation
        into quoted_fee_cents, quoted_fee_bps_applied, quote_claim_generation;
      quote_claim_created := true;
    else
      quoted_fee_cents := existing.fee_cents;
      quoted_fee_bps_applied := existing.fee_bps_applied;
      quote_claim_generation := null;
      quote_claim_created := false;
    end if;
    return next;
    return;
  end if;
  if p_require_existing then
    raise exception 'existing platform fee quote is required';
  end if;
  select coalesce(sum(volume.gross_cents), 0)::bigint into month_gross
  from (
    select fee.gross_cents from public.platform_fees fee
    where fee.location_id = p_location_id
      and fee.pricing_month_start = p_month_start
    union all
    select quote.gross_cents from public.platform_fee_quotes quote
    where quote.location_id = p_location_id and quote.month_start = p_month_start
      and not exists (select 1 from public.platform_fees fee where fee.order_id = quote.order_id)
  ) volume;
  below_cents := least(p_charge_cents,
    greatest(0::bigint, p_tier_threshold_cents - month_gross));
  calculated_fee := round((below_cents::numeric * p_fee_bps
    + (p_charge_cents - below_cents)::numeric * p_fee_bps_tier2) / 10000)::bigint;
  if calculated_fee::numeric * 10 > p_charge_cents::numeric
      * (case when p_charge_cents < 500 then 6 else 9 end) then
    raise exception 'Square platform fee exceeds the provider limit';
  end if;
  insert into public.platform_fee_quotes (
    order_id, brand_id, location_id, month_start, month_end,
    gross_cents, fee_cents, fee_bps_applied, expires_at,
    connection_id, connection_generation
  ) values (
    order_row.id, order_row.brand_id, order_row.location_id, p_month_start, p_month_end,
    p_charge_cents, calculated_fee,
    round(calculated_fee::numeric * 10000 / p_charge_cents)::integer,
    least(p_month_end, pg_catalog.now() + interval '1 hour'),
    p_connection_id, p_connection_generation
  ) returning fee_cents, fee_bps_applied, claim_generation
    into quoted_fee_cents, quoted_fee_bps_applied, quote_claim_generation;
  quote_claim_created := true;
  return next;
end $$;

drop function public.release_platform_fee_quote(uuid);

create function public.release_platform_fee_quote(
  p_order_id uuid,
  p_claim_generation uuid
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  order_row public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null then return false; end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into order_row from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  delete from public.platform_fee_quotes candidate
  where candidate.order_id = p_order_id
    and candidate.claim_generation = p_claim_generation
    and quote.order_id is not null
    and quote.cleanup_claimed_at is null
    and order_row.id is not null
    and order_row.square_order_id is null
    and order_row.square_checkout_url is null
    and order_row.square_payment_link_id is null
    and order_row.square_payment_id is null
    and not exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id)
    and not exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id);
  return found;
end $$;

create function public.bind_square_checkout_link(
  p_order_id uuid,
  p_claim_generation uuid,
  p_checkout_url text,
  p_payment_link_id text,
  p_square_order_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_checkout_url is null or p_payment_link_id is null or p_square_order_id is null
    or p_checkout_url !~ '^https://[^[:space:]]{3,}$'
    or pg_catalog.octet_length(p_checkout_url) > 2048
    or pg_catalog.octet_length(p_payment_link_id) not between 3 and 255
    or p_payment_link_id ~ '[[:space:]]'
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' then
    raise exception 'square checkout link identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then
    select * into target from public.orders where id = p_order_id for update;
    return coalesce(target.id is not null and target.tender_type = 'square_link'
      and target.status <> 'cancelled'
      and target.square_checkout_url is not distinct from p_checkout_url
      and target.square_payment_link_id is not distinct from p_payment_link_id
      and target.square_order_id is not distinct from p_square_order_id
      and exists (select 1 from public.platform_fees fee
        where fee.order_id = p_order_id)
      and not exists (select 1 from app_private.square_attempt_terminal_evidence terminal
        where terminal.order_id = p_order_id), false);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.tender_type <> 'square_link'
    or target.status not in ('created', 'cancelled') or target.square_payment_id is not null
    or quote.order_id is null
    or quote.claim_generation <> p_claim_generation
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id)
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id) then return false; end if;
  if (quote.cleanup_claimed_at is null and (
      target.status <> 'created' or quote.expires_at <= pg_catalog.now()))
    or (quote.cleanup_claimed_at is not null and quote.expires_at > pg_catalog.now()) then
    return false;
  end if;
  if (target.square_checkout_url is not null
      and target.square_checkout_url is distinct from p_checkout_url)
    or (target.square_payment_link_id is not null
      and target.square_payment_link_id is distinct from p_payment_link_id)
    or (target.square_order_id is not null
      and target.square_order_id is distinct from p_square_order_id) then
    return false;
  end if;
  if target.square_checkout_url is not null
    and target.square_payment_link_id is not null
    and target.square_order_id is not null then return true; end if;
  if exists (select 1 from public.orders candidate
    where candidate.id <> p_order_id and (
      candidate.square_payment_link_id = p_payment_link_id
      or candidate.square_order_id = p_square_order_id
    )) or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.square_payment_link_id = p_payment_link_id
        or terminal.square_order_id = p_square_order_id) then return false; end if;
  begin
    update public.orders set square_checkout_url = p_checkout_url,
      square_payment_link_id = p_payment_link_id,
      square_order_id = p_square_order_id where id = p_order_id;
  exception when unique_violation then
    return false;
  end;
  return true;
end $$;

create function public.bind_square_checkout_link_replay(
  p_order_id uuid,
  p_checkout_url text,
  p_payment_link_id text,
  p_square_order_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_checkout_url is null
    or p_payment_link_id is null or p_square_order_id is null
    or p_checkout_url !~ '^https://[^[:space:]]{3,}$'
    or pg_catalog.octet_length(p_checkout_url) > 2048
    or pg_catalog.octet_length(p_payment_link_id) not between 3 and 255
    or p_payment_link_id ~ '[[:space:]]'
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' then
    raise exception 'square checkout link identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.tender_type <> 'square_link'
    or target.status <> 'created' or target.square_payment_id is not null
    or quote.order_id is null
    or quote.cleanup_claimed_at is not null or quote.expires_at <= pg_catalog.now()
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id)
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id) then return false; end if;
  if (target.square_checkout_url is not null
      and target.square_checkout_url is distinct from p_checkout_url)
    or (target.square_payment_link_id is not null
      and target.square_payment_link_id is distinct from p_payment_link_id)
    or (target.square_order_id is not null
      and target.square_order_id is distinct from p_square_order_id) then
    return false;
  end if;
  if target.square_checkout_url is not null
    and target.square_payment_link_id is not null
    and target.square_order_id is not null then return true; end if;
  if exists (select 1 from public.orders candidate
    where candidate.id <> p_order_id and (
      candidate.square_payment_link_id = p_payment_link_id
      or candidate.square_order_id = p_square_order_id
    )) or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.square_payment_link_id = p_payment_link_id
        or terminal.square_order_id = p_square_order_id) then return false; end if;
  begin
    update public.orders set square_checkout_url = p_checkout_url,
      square_payment_link_id = p_payment_link_id,
      square_order_id = p_square_order_id where id = p_order_id;
  exception when unique_violation then
    return false;
  end;
  return true;
end $$;

create function public.bind_square_payment_attempt(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_order_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_order_id is null
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' then
    raise exception 'square payment attempt identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.tender_type <> 'square_card'
    or target.status not in ('created', 'cancelled') or target.square_payment_id is not null
    or quote.order_id is null or quote.claim_generation <> p_claim_generation
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id) then return false; end if;
  if (quote.cleanup_claimed_at is null and (
      target.status <> 'created' or quote.expires_at <= pg_catalog.now()))
    or (quote.cleanup_claimed_at is not null and quote.expires_at > pg_catalog.now()) then
    return false;
  end if;
  if target.square_order_id is not null
    and target.square_order_id <> p_square_order_id then return false; end if;
  if target.square_order_id is not null then
    return target.square_order_id is not distinct from p_square_order_id;
  end if;
  if exists (select 1 from public.orders candidate
    where candidate.square_order_id = p_square_order_id
      and candidate.id <> p_order_id) then
    return false;
  end if;
  begin
    update public.orders set square_order_id = p_square_order_id
    where id = p_order_id;
  exception when unique_violation then
    return false;
  end;
  return true;
end $$;

create function public.bind_square_payment(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_order_id text,
  p_square_payment_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_order_id is null or p_square_payment_id is null
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or pg_catalog.octet_length(p_square_payment_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' or p_square_payment_id ~ '[[:space:]]' then
    raise exception 'square payment identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then
    select * into target from public.orders where id = p_order_id for update;
    return coalesce(target.id is not null and target.tender_type = 'square_card'
      and target.square_order_id is not distinct from p_square_order_id
      and target.square_payment_id is not distinct from p_square_payment_id
      and exists (select 1 from public.platform_fees fee
        where fee.order_id = target.id
          and fee.square_payment_id = p_square_payment_id)
      and not exists (select 1 from app_private.square_attempt_terminal_evidence terminal
        where terminal.order_id = p_order_id), false);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if target.id is null or target.tender_type <> 'square_card' then return false; end if;
  if exists (select 1 from app_private.square_attempt_terminal_evidence terminal
    where terminal.order_id = p_order_id) then return false; end if;
  if target.square_payment_id is not null then
    return target.square_payment_id is not distinct from p_square_payment_id
      and target.square_order_id is not distinct from p_square_order_id;
  end if;
  if target.status <> 'created' or quote.expires_at <= pg_catalog.now()
    or quote.order_id is null or quote.claim_generation <> p_claim_generation
    or quote.cleanup_claimed_at is not null then return false; end if;
  if target.square_order_id is distinct from p_square_order_id then
    return false;
  end if;
  if exists (select 1 from public.orders candidate
    where candidate.square_payment_id = p_square_payment_id
      and candidate.id <> p_order_id) then
    return false;
  end if;
  begin
    update public.orders set square_payment_id = p_square_payment_id
    where id = p_order_id;
  exception when unique_violation then
    return false;
  end;
  return true;
end $$;

create function public.finalize_square_card_payment(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_order_id text,
  p_square_payment_id text,
  p_settled_fee_cents bigint
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
  prior_fee public.platform_fees%rowtype;
  gross_cents bigint;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_order_id is null or p_square_payment_id is null
    or p_settled_fee_cents is null
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or pg_catalog.octet_length(p_square_payment_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' or p_square_payment_id ~ '[[:space:]]' then
    raise exception 'square card settlement identity is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'platform-fee:' || quote.location_id::text || ':'
        || pg_catalog.date_part('epoch', quote.month_start)::text, 0
    ));
  end if;
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null or target.tender_type <> 'square_card'
    or target.square_order_id is distinct from p_square_order_id then
    return false;
  end if;
  gross_cents := target.total_cents - target.stored_value_applied_cents;
  if gross_cents <= 0 or p_settled_fee_cents < 0
    or p_settled_fee_cents::numeric * 10 > gross_cents::numeric
      * (case when gross_cents < 500 then 6 else 9 end) then
    raise exception 'square card settlement amount is invalid';
  end if;
  select * into prior_fee from public.platform_fees fee
  where fee.square_payment_id = p_square_payment_id for update;
  if target.square_payment_id = p_square_payment_id
    and prior_fee.id is not null then
    if prior_fee.order_id is distinct from target.id
      or prior_fee.brand_id is distinct from target.brand_id
      or prior_fee.location_id is distinct from target.location_id
      or prior_fee.gross_cents is distinct from gross_cents
      or prior_fee.fee_cents is distinct from p_settled_fee_cents
      or prior_fee.fee_bps_applied is distinct from
        pg_catalog.round(p_settled_fee_cents::numeric * 10000 / gross_cents)::integer then
      return false;
    end if;
    if target.status = 'created' then
      insert into public.order_events (brand_id, order_id, type, snapshot, source)
      values (target.brand_id, target.id, 'paid',
        target.totals || pg_catalog.jsonb_build_object(
          'square_payment_id', p_square_payment_id,
          'card_charge_cents', gross_cents,
          'recovered', true
        ), 'system');
    end if;
    return target.status <> 'cancelled';
  end if;
  if (target.square_payment_id is not null
      and target.square_payment_id <> p_square_payment_id)
    or target.status <> 'created' or prior_fee.id is not null then return false; end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if quote.order_id is null
    or quote.brand_id is distinct from target.brand_id
    or quote.location_id is distinct from target.location_id
    or quote.gross_cents is distinct from gross_cents
    or quote.fee_cents is distinct from p_settled_fee_cents
    or quote.fee_bps_applied is distinct from
      pg_catalog.round(p_settled_fee_cents::numeric * 10000 / gross_cents)::integer
    or exists (select 1 from public.platform_fees fee
      where fee.order_id = p_order_id) then return false; end if;
  if target.square_payment_id is null
    and quote.claim_generation <> p_claim_generation then return false; end if;
  begin
    update public.orders set square_payment_id = p_square_payment_id
    where id = p_order_id and square_payment_id is null;
    insert into public.platform_fees (
      brand_id, location_id, order_id, gross_cents, fee_cents,
      fee_bps_applied, square_payment_id, pricing_month_start, pricing_month_end
    ) values (
      target.brand_id, target.location_id, target.id, gross_cents,
      p_settled_fee_cents,
      pg_catalog.round(p_settled_fee_cents::numeric * 10000 / gross_cents)::integer,
      p_square_payment_id, quote.month_start, quote.month_end
    );
  exception when unique_violation then
    return false;
  end;
  insert into public.order_events (brand_id, order_id, type, snapshot, source)
  values (target.brand_id, target.id, 'paid',
    target.totals || pg_catalog.jsonb_build_object(
      'square_payment_id', p_square_payment_id,
      'card_charge_cents', gross_cents
    ), 'system');
  return true;
end $$;

create function public.get_square_payment_quote(
  p_order_id uuid,
  p_square_order_id text
)
returns table (
  gross_cents bigint,
  quoted_fee_cents bigint,
  quoted_fee_bps_applied integer,
  quote_finalized boolean
)
language plpgsql security definer stable set search_path = '' as $$
declare
  target public.orders%rowtype;
  quote public.platform_fee_quotes%rowtype;
  fee public.platform_fees%rowtype;
begin
  if p_order_id is null or p_square_order_id is null
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]' then
    raise exception 'square payment quote identity is invalid';
  end if;
  select * into target from public.orders where id = p_order_id;
  if target.id is null or target.tender_type <> 'square_card'
    or target.square_order_id is distinct from p_square_order_id then return; end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is not null then
    gross_cents := quote.gross_cents;
    quoted_fee_cents := quote.fee_cents;
    quoted_fee_bps_applied := quote.fee_bps_applied;
    quote_finalized := false;
    return next;
    return;
  end if;
  select * into fee from public.platform_fees candidate
  where candidate.order_id = p_order_id
    and candidate.square_payment_id is not distinct from target.square_payment_id;
  if fee.id is not null then
    gross_cents := fee.gross_cents;
    quoted_fee_cents := fee.fee_cents;
    quoted_fee_bps_applied := fee.fee_bps_applied;
    quote_finalized := true;
    return next;
  end if;
end $$;

-- Webhook and recovery settlement uses the same quote receipt as attended
-- capture. An exact existing receipt is an idempotent replay; a new receipt
-- requires the still-durable quote and the exact provider-collected app fee.
drop function public.record_square_payment_settlement(uuid, text, text, bigint, text);

create function public.record_square_payment_settlement(
  target_order uuid,
  square_event text,
  square_order text,
  square_payment text,
  settled_fee_cents bigint,
  square_event_type text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
  quote public.platform_fee_quotes%rowtype;
  prior_event public.order_events%rowtype;
  prior_fee public.platform_fees%rowtype;
  terminal app_private.square_attempt_terminal_evidence%rowtype;
  remediation app_private.square_payment_remediation_outbox%rowtype;
  gross_cents bigint;
  expected_bps integer;
  event_written boolean := false;
begin
  if target_order is null or square_event is null or square_order is null
    or square_payment is null
    or square_event_type is null or settled_fee_cents is null
    or pg_catalog.octet_length(square_event) not between 3 and 255
    or pg_catalog.octet_length(square_order) not between 3 and 255
    or pg_catalog.octet_length(square_payment) not between 3 and 255
    or pg_catalog.octet_length(square_event_type) not between 1 and 128
    or square_event ~ '[[:space:]]' or square_order ~ '[[:space:]]'
    or square_payment ~ '[[:space:]]' then
    raise exception 'Square settlement identity and fee are required';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = target_order;
  if quote.order_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'platform-fee:' || quote.location_id::text || ':'
        || pg_catalog.date_part('epoch', quote.month_start)::text, 0
    ));
  end if;
  select * into target from public.orders where id = target_order for update;
  if target.id is null then raise exception 'order does not exist'; end if;
  if target.tender_type not in ('square_card', 'square_link') then
    raise exception 'order was not paid through Square';
  end if;
  if target.square_order_id is distinct from square_order then
    raise exception 'Square settlement does not match its durable order identity';
  end if;
  gross_cents := target.total_cents - target.stored_value_applied_cents;
  if gross_cents <= 0 or settled_fee_cents < 0
    or settled_fee_cents::numeric * 10 > gross_cents::numeric
      * (case when gross_cents < 500 then 6 else 9 end) then
    raise exception 'invalid Square settlement amounts';
  end if;
  expected_bps := pg_catalog.round(
    settled_fee_cents::numeric * 10000 / gross_cents)::integer;
  select * into prior_event from public.order_events event
  where event.square_event_id = square_event;
  if prior_event.id is not null and (
    prior_event.order_id is distinct from target.id
    or (prior_event.type is distinct from 'paid'::app.order_status
      and not (target.status = 'cancelled'
        and prior_event.type = 'cancelled'::app.order_status
        and prior_event.snapshot ->> 'late_settlement_after_cancellation' = 'true'))
    or prior_event.snapshot ->> 'square_payment_id' is distinct from square_payment
    or prior_event.snapshot ->> 'square_event' is distinct from square_event_type
  ) then
    raise exception 'Square event is already bound to a different settlement';
  end if;
  select * into prior_fee from public.platform_fees fee
  where fee.square_payment_id = square_payment for update;
  if prior_fee.id is not null then
    if prior_fee.order_id is distinct from target.id
      or prior_fee.brand_id is distinct from target.brand_id
      or prior_fee.location_id is distinct from target.location_id
      or prior_fee.gross_cents is distinct from gross_cents
      or prior_fee.fee_cents is distinct from settled_fee_cents
      or prior_fee.fee_bps_applied is distinct from expected_bps then
      raise exception 'Square payment is already bound to a different fee receipt';
    end if;
    if target.square_payment_id is not null
      and target.square_payment_id is distinct from square_payment then
      raise exception 'order is already bound to a different Square payment';
    end if;
    update public.orders set square_payment_id = square_payment where id = target.id;
    if target.status = 'cancelled' then
      select * into terminal from app_private.square_attempt_terminal_evidence evidence
      where evidence.order_id = target.id for update;
      if terminal.order_id is not null then
        select * into remediation from app_private.square_payment_remediation_outbox queued
        where queued.order_id = target.id for update;
        if remediation.order_id is null
          or remediation.brand_id is distinct from target.brand_id
          or remediation.location_id is distinct from target.location_id
          or remediation.connection_id is distinct from terminal.connection_id
          or remediation.connection_generation is distinct from
            terminal.connection_generation
          or remediation.square_order_id is distinct from square_order
          or remediation.square_payment_id is distinct from square_payment
          or remediation.refund_amount_cents is distinct from gross_cents
          or remediation.refund_request_key is distinct from target.id then
          raise exception 'late Square settlement remediation is incomplete';
        end if;
      end if;
      return false;
    end if;
    if target.status = 'created' then
      insert into public.order_events (
        brand_id, order_id, type, snapshot, square_event_id, source
      ) values (
        target.brand_id, target.id, 'paid', pg_catalog.jsonb_build_object(
          'square_event', square_event_type, 'square_event_id', square_event,
          'square_payment_id', square_payment, 'recovered', true
        ), square_event, 'webhook'
      ) on conflict (square_event_id) do nothing;
      event_written := found;
      if not event_written then
        select * into prior_event from public.order_events
        where square_event_id = square_event;
        if prior_event.id is null or prior_event.order_id is distinct from target.id
          or prior_event.type is distinct from 'paid'::app.order_status
          or prior_event.snapshot ->> 'square_payment_id' is distinct from square_payment
          or prior_event.snapshot ->> 'square_event' is distinct from square_event_type then
          raise exception 'Square event is already bound to a different settlement';
        end if;
      end if;
    elsif target.status not in ('paid', 'in_progress', 'ready', 'picked_up', 'refunded') then
      raise exception 'order cannot accept a Square settlement in status %', target.status;
    end if;
    return event_written;
  end if;
  if target.status = 'cancelled' then
    if target.tender_type <> 'square_card' then
      raise exception 'Square settled a cancelled hosted order without a fee receipt';
    end if;
    select * into terminal from app_private.square_attempt_terminal_evidence evidence
    where evidence.order_id = target.id for update;
    if terminal.order_id is null
      or terminal.tender_type <> 'square_card'
      or terminal.brand_id is distinct from target.brand_id
      or terminal.location_id is distinct from target.location_id
      or terminal.square_order_id is distinct from square_order
      or (terminal.square_payment_id is not null
        and terminal.square_payment_id is distinct from square_payment)
      or terminal.gross_cents is distinct from gross_cents
      or terminal.fee_cents is distinct from settled_fee_cents
      or terminal.fee_bps_applied is distinct from expected_bps then
      raise exception 'late Square settlement does not match terminal payment evidence';
    end if;
    if target.square_payment_id is not null
      and target.square_payment_id is distinct from square_payment then
      raise exception 'order is already bound to a different Square payment';
    end if;
    if exists (select 1 from public.platform_fees fee
      where fee.order_id = target.id) then
      raise exception 'order already has a different Square fee receipt';
    end if;
    update public.orders set square_payment_id = square_payment where id = target.id;
    begin
      insert into public.platform_fees (
        brand_id, location_id, order_id, gross_cents, fee_cents,
        fee_bps_applied, square_payment_id, pricing_month_start, pricing_month_end
      ) values (
        target.brand_id, target.location_id, target.id, gross_cents,
        settled_fee_cents, expected_bps, square_payment,
        terminal.pricing_month_start, terminal.pricing_month_end
      );
      insert into public.order_events (
        brand_id, order_id, type, snapshot, square_event_id, source
      ) values (
        target.brand_id, target.id, 'cancelled', pg_catalog.jsonb_build_object(
          'square_event', square_event_type, 'square_event_id', square_event,
          'square_payment_id', square_payment,
          'late_settlement_after_cancellation', true,
          'remediation', 'full_refund_pending'
        ), square_event, 'webhook'
      );
      insert into app_private.square_payment_remediation_outbox (
        order_id, brand_id, location_id, connection_id, connection_generation,
        square_order_id, square_payment_id, settlement_event_id,
        refund_amount_cents, refund_request_key
      ) values (
        target.id, target.brand_id, target.location_id, terminal.connection_id,
        terminal.connection_generation, square_order, square_payment,
        square_event, gross_cents, target.id
      );
    exception when unique_violation then
      raise exception 'Square settlement identity is already bound to another receipt or remediation';
    end;
    return true;
  end if;
  if target.square_payment_id is not null
    and target.square_payment_id is distinct from square_payment then
    raise exception 'order is already bound to a different Square payment';
  end if;
  select * into quote from public.platform_fee_quotes
  where order_id = target_order for update;
  if quote.order_id is null
    or quote.brand_id is distinct from target.brand_id
    or quote.location_id is distinct from target.location_id
    or quote.gross_cents is distinct from gross_cents
    or quote.fee_cents is distinct from settled_fee_cents
    or quote.fee_bps_applied is distinct from expected_bps then
    raise exception 'Square settlement does not match its durable fee quote';
  end if;
  if exists (select 1 from public.platform_fees fee
    where fee.order_id = target.id) then
    raise exception 'order already has a different Square fee receipt';
  end if;
  update public.orders set square_payment_id = square_payment where id = target.id;
  begin
    insert into public.platform_fees (
      brand_id, location_id, order_id, gross_cents, fee_cents,
      fee_bps_applied, square_payment_id, pricing_month_start, pricing_month_end
    ) values (
      target.brand_id, target.location_id, target.id, gross_cents,
      settled_fee_cents, expected_bps, square_payment, quote.month_start, quote.month_end
    );
  exception when unique_violation then
    raise exception 'Square payment or order is already bound to a different fee receipt';
  end;
  if target.status = 'created' then
    insert into public.order_events (
      brand_id, order_id, type, snapshot, square_event_id, source
    ) values (
      target.brand_id, target.id, 'paid', pg_catalog.jsonb_build_object(
        'square_event', square_event_type, 'square_event_id', square_event,
        'square_payment_id', square_payment
      ), square_event, 'webhook'
    ) on conflict (square_event_id) do nothing;
    event_written := found;
    if not event_written then
      select * into prior_event from public.order_events
      where square_event_id = square_event;
      if prior_event.id is null or prior_event.order_id is distinct from target.id
        or prior_event.type is distinct from 'paid'::app.order_status
        or prior_event.snapshot ->> 'square_payment_id' is distinct from square_payment
        or prior_event.snapshot ->> 'square_event' is distinct from square_event_type then
        raise exception 'Square event is already bound to a different settlement';
      end if;
    end if;
  elsif target.status not in ('paid', 'in_progress', 'ready', 'picked_up', 'refunded') then
    raise exception 'order cannot accept a Square settlement in status %', target.status;
  end if;
  return true;
end $$;

create function public.claim_due_square_payment_remediations(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  connection_id uuid,
  connection_generation uuid,
  square_order_id text,
  square_payment_id text,
  refund_amount_cents bigint,
  refund_request_key uuid,
  square_refund_id text,
  provider_refund_status text,
  attempt_count integer,
  claim_generation uuid
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 50
    or p_now < pg_catalog.now() - interval '5 minutes'
    or p_now > pg_catalog.now() + interval '5 minutes' then
    raise exception 'invalid Square payment remediation claim inputs';
  end if;
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_pending_too_long'
  where queued.provider_refund_status = 'PENDING'
    and queued.submitted_at <= p_now - interval '14 days'
    and queued.available_at <= p_now
    and queued.status in ('submitted', 'processing');
  update app_private.square_payment_remediation_outbox queued set
    status = 'manual_action_required', claimed_at = null,
    manual_action_required_at = coalesce(queued.manual_action_required_at, p_now),
    last_error_code = 'refund_connection_unavailable'
  where queued.status <> 'completed'
    and not exists (select 1 from public.square_connections connection
      where connection.id = queued.connection_id
        and connection.connection_generation = queued.connection_generation)
    and not exists (select 1 from app_private.square_connection_mutation_fences fence
      where fence.location_id = queued.location_id
        and fence.mutation_generation is not null);
  return query with due as materialized (
    select queued.order_id
    from app_private.square_payment_remediation_outbox queued
    join app_private.square_connection_mutation_fences fence
      on fence.location_id = queued.location_id
    join public.square_connections connection
      on connection.id = queued.connection_id
      and connection.connection_generation = queued.connection_generation
    where queued.available_at <= p_now
      and fence.mutation_generation is null
      and (
        queued.status = 'submitted'
        or queued.status = 'processing'
        or (queued.status in ('pending', 'failed') and queued.attempt_count < 20)
      )
    order by queued.available_at, queued.order_id
    for update of queued, fence skip locked limit p_limit
  ), claimed as (
    update app_private.square_payment_remediation_outbox queued set
      status = 'processing',
      attempt_count = case
        when queued.square_refund_id is null and queued.attempt_count < 20
          then queued.attempt_count + 1
        else queued.attempt_count
      end,
      poll_attempt_count = queued.poll_attempt_count
        + case when queued.square_refund_id is null then 0 else 1 end,
      claimed_at = p_now,
      claim_generation = gen_random_uuid(),
      available_at = p_now + interval '5 minutes',
      last_error_code = null
    from due where queued.order_id = due.order_id returning queued.*
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id,
    claimed.connection_id, claimed.connection_generation,
    claimed.square_order_id, claimed.square_payment_id,
    claimed.refund_amount_cents, claimed.refund_request_key,
    claimed.square_refund_id, claimed.provider_refund_status,
    claimed.attempt_count, claimed.claim_generation
  from claimed;
end $$;

create function public.finalize_square_payment_remediation(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_refund_id text,
  p_provider_refund_status text,
  p_provider_payment_id text,
  p_provider_refund_amount_cents bigint,
  p_provider_refund_currency text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
  queued app_private.square_payment_remediation_outbox%rowtype;
  prior_refund public.order_events%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_refund_id is null or p_provider_payment_id is null
    or pg_catalog.octet_length(p_square_refund_id) not between 3 and 255
    or pg_catalog.octet_length(p_provider_payment_id) not between 3 and 255
    or p_square_refund_id ~ '[[:space:]]'
    or p_provider_payment_id ~ '[[:space:]]'
    or p_provider_refund_status is null
    or p_provider_refund_status not in ('PENDING', 'COMPLETED', 'REJECTED', 'FAILED')
    or p_provider_refund_amount_cents is null or p_provider_refund_amount_cents <= 0
    or p_provider_refund_currency is distinct from 'USD' then
    raise exception 'invalid Square payment remediation result';
  end if;
  select * into target from public.orders where id = p_order_id for update;
  if target.id is null then return false; end if;
  select * into queued from app_private.square_payment_remediation_outbox candidate
  where candidate.order_id = p_order_id for update;
  if queued.order_id is null
    or target.status <> 'cancelled'
    or target.square_order_id is distinct from queued.square_order_id
    or target.square_payment_id is distinct from queued.square_payment_id
    or p_provider_payment_id is distinct from queued.square_payment_id
    or p_provider_refund_amount_cents is distinct from queued.refund_amount_cents then
    return false;
  end if;
  if exists (select 1 from app_private.square_payment_remediation_outbox candidate
      where candidate.square_refund_id = p_square_refund_id
        and candidate.order_id <> p_order_id)
    or exists (select 1 from public.order_events event
      where event.square_refund_id = p_square_refund_id
        and event.order_id <> p_order_id) then
    return false;
  end if;
  if queued.status = 'completed' then
    return queued.claim_generation = p_claim_generation
      and queued.square_refund_id = p_square_refund_id
      and queued.provider_refund_status = 'COMPLETED'
      and p_provider_refund_status = 'COMPLETED'
      and queued.provider_refund_payment_id = p_provider_payment_id
      and queued.provider_refund_amount_cents = p_provider_refund_amount_cents
      and queued.provider_refund_currency = p_provider_refund_currency;
  end if;
  if queued.status = 'manual_action_required' then
    return queued.claim_generation = p_claim_generation
      and queued.square_refund_id = p_square_refund_id
      and queued.provider_refund_status = p_provider_refund_status
      and p_provider_refund_status in ('REJECTED', 'FAILED')
      and queued.provider_refund_payment_id = p_provider_payment_id
      and queued.provider_refund_amount_cents = p_provider_refund_amount_cents
      and queued.provider_refund_currency = p_provider_refund_currency;
  end if;
  if queued.status not in ('processing', 'submitted')
    or queued.claim_generation <> p_claim_generation
    or (queued.square_refund_id is not null
      and queued.square_refund_id <> p_square_refund_id)
    or (queued.provider_refund_payment_id is not null
      and queued.provider_refund_payment_id <> p_provider_payment_id)
    or (queued.provider_refund_amount_cents is not null
      and queued.provider_refund_amount_cents <> p_provider_refund_amount_cents)
    or (queued.provider_refund_currency is not null
      and queued.provider_refund_currency <> p_provider_refund_currency) then
    return false;
  end if;
  if p_provider_refund_status = 'PENDING' then
    update app_private.square_payment_remediation_outbox set
      status = 'submitted', square_refund_id = p_square_refund_id,
      provider_refund_status = 'PENDING',
      provider_refund_payment_id = p_provider_payment_id,
      provider_refund_amount_cents = p_provider_refund_amount_cents,
      provider_refund_currency = p_provider_refund_currency,
      submitted_at = coalesce(submitted_at, pg_catalog.now()),
      claimed_at = null, available_at = pg_catalog.now() + interval '5 minutes',
      last_error_code = null
    where order_id = p_order_id;
    return true;
  end if;
  if p_provider_refund_status in ('REJECTED', 'FAILED') then
    update app_private.square_payment_remediation_outbox set
      status = 'manual_action_required', square_refund_id = p_square_refund_id,
      provider_refund_status = p_provider_refund_status,
      provider_refund_payment_id = p_provider_payment_id,
      provider_refund_amount_cents = p_provider_refund_amount_cents,
      provider_refund_currency = p_provider_refund_currency,
      submitted_at = coalesce(submitted_at, pg_catalog.now()),
      claimed_at = null, manual_action_required_at = pg_catalog.now(),
      last_error_code = case when p_provider_refund_status = 'REJECTED'
        then 'provider_refund_rejected' else 'provider_refund_failed' end
    where order_id = p_order_id;
    return true;
  end if;
  select * into prior_refund from public.order_events event
  where event.square_refund_id = p_square_refund_id;
  if prior_refund.id is null then
    begin
      insert into public.order_events (
        brand_id, order_id, type, snapshot, square_refund_id,
        refund_cents, source
      ) values (
        queued.brand_id, queued.order_id, 'cancelled',
        pg_catalog.jsonb_build_object(
          'square_refund_id', p_square_refund_id,
          'square_payment_id', p_provider_payment_id,
          'refunded_cents', queued.refund_amount_cents,
          'currency', p_provider_refund_currency,
          'reason', 'late_square_settlement_remediation'
        ), p_square_refund_id, queued.refund_amount_cents, 'webhook'
      );
    exception when unique_violation then
      select * into prior_refund from public.order_events event
      where event.square_refund_id = p_square_refund_id;
      if prior_refund.id is null then return false; end if;
    end;
  end if;
  if prior_refund.id is not null and (
    prior_refund.brand_id is distinct from queued.brand_id
    or prior_refund.order_id is distinct from queued.order_id
    or prior_refund.refund_cents is distinct from queued.refund_amount_cents
    or prior_refund.snapshot ->> 'square_payment_id' is distinct from p_provider_payment_id
  ) then
    return false;
  end if;
  update app_private.square_payment_remediation_outbox set
    status = 'completed', square_refund_id = p_square_refund_id,
    provider_refund_status = 'COMPLETED',
    provider_refund_payment_id = p_provider_payment_id,
    provider_refund_amount_cents = p_provider_refund_amount_cents,
    provider_refund_currency = p_provider_refund_currency,
    submitted_at = coalesce(submitted_at, pg_catalog.now()),
    claimed_at = null, completed_at = pg_catalog.now(),
    manual_action_required_at = null, last_error_code = null
  where order_id = p_order_id;
  return true;
end $$;

create function public.fail_square_payment_remediation(
  p_order_id uuid,
  p_claim_generation uuid,
  p_error_code text,
  p_retry_at timestamptz
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  queued app_private.square_payment_remediation_outbox%rowtype;
begin
  if p_order_id is null or p_claim_generation is null or p_error_code is null
    or p_error_code !~ '^[a-z0-9_]{1,64}$' or p_retry_at is null then
    raise exception 'invalid Square payment remediation failure';
  end if;
  select * into queued from app_private.square_payment_remediation_outbox candidate
  where candidate.order_id = p_order_id for update;
  if queued.order_id is null then return false; end if;
  if queued.status in ('failed', 'submitted', 'manual_action_required') then
    return queued.claim_generation = p_claim_generation
      and queued.last_error_code = p_error_code
      and queued.available_at = p_retry_at;
  end if;
  if queued.status <> 'processing'
    or queued.claim_generation <> p_claim_generation then return false; end if;
  if p_retry_at <= pg_catalog.now()
    or p_retry_at > pg_catalog.now() + interval '1 day' then
    raise exception 'Square payment remediation retry is outside the allowed window';
  end if;
  if queued.square_refund_id is not null then
    update app_private.square_payment_remediation_outbox set
      status = 'submitted', available_at = p_retry_at,
      claimed_at = null, last_error_code = p_error_code
    where order_id = p_order_id;
  elsif queued.attempt_count >= 20 then
    update app_private.square_payment_remediation_outbox set
      status = 'manual_action_required', available_at = p_retry_at,
      claimed_at = null, last_error_code = p_error_code,
      manual_action_required_at = pg_catalog.now()
    where order_id = p_order_id;
  else
    update app_private.square_payment_remediation_outbox set
      status = 'failed', available_at = p_retry_at,
      claimed_at = null, last_error_code = p_error_code
    where order_id = p_order_id;
  end if;
  return true;
end $$;

create function public.count_square_payment_remediation_alerts()
returns bigint language sql stable security definer set search_path = '' as $$
  select pg_catalog.count(*)
  from app_private.square_payment_remediation_outbox queued
  where queued.status = 'manual_action_required'
$$;

create function public.record_square_payment_validation_alert(
  p_event_id text,
  p_error_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  delivery_id uuid;
  existing app_private.square_payment_validation_alerts%rowtype;
begin
  if p_event_id is null
    or pg_catalog.octet_length(p_event_id) not between 3 and 255
    or p_event_id ~ '[[:space:]]'
    or p_error_code not in (
      'payment_event_invalid', 'payment_amount_invalid', 'payment_fee_invalid',
      'payment_location_invalid', 'payment_order_binding_invalid',
      'payment_settlement_conflict'
    ) then
    raise exception using errcode = '22023',
      message = 'square_payment_validation_alert_invalid';
  end if;
  select delivery.id into delivery_id from public.webhook_events delivery
  where delivery.provider = 'square' and delivery.event_id = p_event_id for update;
  if delivery_id is null then
    raise exception using errcode = '22023',
      message = 'square_payment_validation_delivery_missing';
  end if;
  select candidate.* into existing
  from app_private.square_payment_validation_alerts candidate
  where candidate.event_id = p_event_id for update;
  if existing.event_id is not null then
    if existing.error_code is distinct from p_error_code then
      raise exception using errcode = '55000',
        message = 'square_payment_validation_alert_conflict';
    end if;
    return true;
  end if;
  insert into app_private.square_payment_validation_alerts (event_id, error_code)
  values (p_event_id, p_error_code);
  return true;
end $$;

create function public.resolve_square_payment_validation_alert(
  p_event_id text,
  p_resolution_code text,
  p_evidence_reference text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  existing app_private.square_payment_validation_alerts%rowtype;
begin
  if p_event_id is null or p_resolution_code is null
    or p_evidence_reference is null
    or pg_catalog.octet_length(p_event_id) not between 3 and 255
    or p_event_id ~ '[[:space:]]'
    or p_resolution_code !~ '^[a-z0-9_]{1,64}$'
    or pg_catalog.octet_length(p_evidence_reference) not between 3 and 255
    or p_evidence_reference ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023',
      message = 'square_payment_validation_resolution_invalid';
  end if;
  select candidate.* into existing
  from app_private.square_payment_validation_alerts candidate
  where candidate.event_id = p_event_id for update;
  if existing.event_id is null then return false; end if;
  if existing.resolved_at is not null then
    return existing.resolution_code = p_resolution_code
      and existing.evidence_reference = p_evidence_reference;
  end if;
  update app_private.square_payment_validation_alerts candidate set
    resolved_at = pg_catalog.now(), resolution_code = p_resolution_code,
    evidence_reference = p_evidence_reference
  where candidate.event_id = p_event_id;
  return true;
end $$;

create function public.count_square_payment_validation_alerts()
returns bigint language sql stable security definer set search_path = '' as $$
  select pg_catalog.count(*)
  from app_private.square_payment_validation_alerts alert
  where alert.resolved_at is null
$$;

-- A completed refund webhook can win a worker lease. Reconcile the same
-- immutable full-refund intent and accounting event instead of waiting for a
-- later poll, while preserving the predecessor behavior for ordinary refunds.
create or replace function public.process_square_refund(
  target_order uuid,
  square_event text,
  square_refund text,
  refunded_cents bigint,
  square_event_type text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
  queued app_private.square_payment_remediation_outbox%rowtype;
  prior public.order_events%rowtype;
  charged_cents bigint;
  refunded_before bigint;
  event_type app.order_status;
begin
  if target_order is null or square_event is null or square_refund is null
    or square_event_type is null or refunded_cents is null or refunded_cents <= 0
    or pg_catalog.octet_length(square_event) not between 3 and 255
    or pg_catalog.octet_length(square_refund) not between 3 and 255
    or pg_catalog.octet_length(square_event_type) not between 1 and 128
    or square_event ~ '[[:space:]]' or square_refund ~ '[[:space:]]' then
    raise exception 'invalid Square refund result';
  end if;
  select candidate.* into target from public.orders candidate
  where candidate.id = target_order for update;
  if target.id is null then raise exception 'order does not exist'; end if;
  select candidate.* into queued
  from app_private.square_payment_remediation_outbox candidate
  where candidate.order_id = target_order for update;
  select event.* into prior from public.order_events event
  where event.square_event_id = square_event
    or event.square_refund_id = square_refund
  order by (event.square_refund_id = square_refund) desc limit 1;
  if queued.order_id is not null then
    if target.status <> 'cancelled'
      or target.brand_id is distinct from queued.brand_id
      or target.location_id is distinct from queued.location_id
      or target.square_order_id is distinct from queued.square_order_id
      or target.square_payment_id is distinct from queued.square_payment_id
      or refunded_cents is distinct from queued.refund_amount_cents
      or (queued.square_refund_id is not null
        and queued.square_refund_id is distinct from square_refund)
      or exists (select 1 from public.order_events event
        where (event.square_event_id = square_event
            or event.square_refund_id = square_refund)
          and (event.order_id is distinct from target_order
            or event.square_refund_id is distinct from square_refund
            or event.refund_cents is distinct from refunded_cents
            or event.snapshot ->> 'square_payment_id' is distinct from
              queued.square_payment_id)) then
      raise exception 'Square refund does not match its remediation intent';
    end if;
    if prior.id is null then
      insert into public.order_events (
        brand_id, order_id, type, snapshot, square_event_id,
        square_refund_id, refund_cents, source
      ) values (
        target.brand_id, target.id, 'cancelled', pg_catalog.jsonb_build_object(
          'square_event', square_event_type,
          'square_event_id', square_event,
          'square_refund_id', square_refund,
          'square_payment_id', queued.square_payment_id,
          'refunded_cents', refunded_cents,
          'currency', 'USD',
          'reason', 'late_square_settlement_remediation'
        ), square_event, square_refund, refunded_cents, 'webhook'
      );
    end if;
    update app_private.square_payment_remediation_outbox candidate set
      status = 'completed', square_refund_id = square_refund,
      provider_refund_status = 'COMPLETED',
      provider_refund_payment_id = candidate.square_payment_id,
      provider_refund_amount_cents = candidate.refund_amount_cents,
      provider_refund_currency = 'USD', claimed_at = null,
      completed_at = coalesce(candidate.completed_at, pg_catalog.now()),
      manual_action_required_at = null, last_error_code = null
    where candidate.order_id = target_order;
    return prior.id is null;
  end if;
  if prior.id is not null then return false; end if;
  charged_cents := pg_catalog.greatest(
    0, target.total_cents - target.stored_value_applied_cents);
  if charged_cents = 0 then raise exception 'order has no Square-funded amount'; end if;
  select coalesce(pg_catalog.sum(event.refund_cents), 0) into refunded_before
  from public.order_events event where event.order_id = target_order
    and event.square_refund_id is not null;
  event_type := case when refunded_before + refunded_cents >= charged_cents
    then 'refunded'::app.order_status else target.status end;
  insert into public.order_events (
    brand_id, order_id, type, snapshot, square_event_id,
    square_refund_id, refund_cents, source
  ) values (
    target.brand_id, target.id, event_type, pg_catalog.jsonb_build_object(
      'square_event', square_event_type, 'square_event_id', square_event,
      'square_refund_id', square_refund, 'refunded_cents', refunded_cents
    ), square_event, square_refund, refunded_cents, 'webhook'
  );
  return true;
exception when unique_violation then
  return false;
end $$;

drop function public.claim_due_square_checkout_quotes(timestamptz, integer);
drop function public.expire_square_checkout_quote(uuid, text);

create function public.claim_due_square_checkout_quotes(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  expires_at timestamptz,
  claim_generation uuid,
  square_checkout_url text,
  square_payment_link_id text,
  square_order_id text,
  gross_cents bigint,
  quoted_fee_cents bigint,
  quoted_fee_bps_applied integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid Square checkout cleanup claim inputs';
  end if;
  return query with due as materialized (
    select quote.order_id
    from public.platform_fee_quotes quote
    join public.orders target on target.id = quote.order_id
    where quote.expires_at <= p_now
      and target.tender_type = 'square_link'
      and target.status in ('created', 'cancelled')
      and not exists (select 1 from public.platform_fees fee
        where fee.order_id = quote.order_id)
      and not exists (select 1 from app_private.square_attempt_terminal_evidence terminal
        where terminal.order_id = quote.order_id)
      and (quote.cleanup_claimed_at is null
        or quote.cleanup_claimed_at <= p_now - interval '5 minutes')
    order by quote.cleanup_claimed_at asc nulls first,
      quote.expires_at, quote.order_id
    for update of quote skip locked limit p_limit
  ), claimed as (
    update public.platform_fee_quotes quote set
      cleanup_claimed_at = p_now,
      claim_generation = gen_random_uuid()
    from due where quote.order_id = due.order_id
    returning quote.*
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id,
    claimed.expires_at, claimed.claim_generation,
    target.square_checkout_url, target.square_payment_link_id,
    target.square_order_id, claimed.gross_cents, claimed.fee_cents,
    claimed.fee_bps_applied
  from claimed join public.orders target on target.id = claimed.order_id;
end $$;

create function public.expire_square_checkout_quote(
  p_order_id uuid,
  p_claim_generation uuid,
  p_payment_link_id text,
  p_square_order_id text,
  p_provider_order_version bigint,
  p_provider_order_state text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_payment_link_id is null or p_square_order_id is null
    or p_provider_order_version is null or p_provider_order_version < 0
    or p_provider_order_state is distinct from 'CANCELED'
    or pg_catalog.octet_length(p_payment_link_id) not between 3 and 255
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_payment_link_id ~ '[[:space:]]' or p_square_order_id ~ '[[:space:]]' then
    raise exception 'square checkout expiry evidence is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then
    return exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id and terminal.tender_type = 'square_link'
        and terminal.quote_claim_generation = p_claim_generation
        and terminal.square_payment_link_id = p_payment_link_id
        and terminal.square_order_id = p_square_order_id
        and terminal.provider_order_version = p_provider_order_version
        and terminal.provider_order_state = p_provider_order_state
        and terminal.terminal_reason = 'hosted_checkout_expired');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if quote.order_id is null or quote.expires_at > pg_catalog.now()
    or quote.cleanup_claimed_at is null or quote.claim_generation <> p_claim_generation
    or target.id is null or target.tender_type <> 'square_link'
    or target.status not in ('created', 'cancelled')
    or target.square_payment_link_id is distinct from p_payment_link_id
    or target.square_order_id is distinct from p_square_order_id
    or target.square_payment_id is not null
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id)
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id)
  then return false; end if;
  begin
    insert into app_private.square_attempt_terminal_evidence (
      order_id, brand_id, location_id, connection_id, connection_generation,
      tender_type, square_order_id, square_payment_link_id, quote_claim_generation,
      pricing_month_start, pricing_month_end, gross_cents, fee_cents,
      fee_bps_applied, provider_order_version, provider_order_state, terminal_reason
    ) values (
      target.id, target.brand_id, target.location_id, quote.connection_id,
      quote.connection_generation, 'square_link', p_square_order_id,
      p_payment_link_id, p_claim_generation, quote.month_start, quote.month_end,
      quote.gross_cents, quote.fee_cents,
      quote.fee_bps_applied, p_provider_order_version, p_provider_order_state,
      'hosted_checkout_expired'
    );
  exception when unique_violation then
    return false;
  end;
  update public.orders set square_checkout_url = null, square_payment_link_id = null
  where id = p_order_id;
  delete from public.platform_fee_quotes where order_id = p_order_id;
  if target.status = 'created' then
    insert into public.order_events (brand_id, order_id, type, snapshot, source)
    values (target.brand_id, target.id, 'cancelled',
      target.totals || pg_catalog.jsonb_build_object(
        'reason', 'hosted_checkout_expired',
        'square_payment_link_id', p_payment_link_id,
        'square_order_id', p_square_order_id,
        'provider_order_version', p_provider_order_version
      ), 'job');
  end if;
  return true;
end $$;

create function public.claim_due_square_card_quotes(
  p_now timestamptz,
  p_limit integer default 50
)
returns table (
  order_id uuid,
  brand_id uuid,
  location_id uuid,
  expires_at timestamptz,
  claim_generation uuid,
  square_order_id text,
  square_payment_id text,
  gross_cents bigint,
  quoted_fee_cents bigint,
  quoted_fee_bps_applied integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid Square card cleanup claim inputs';
  end if;
  return query with due as materialized (
    select quote.order_id
    from public.platform_fee_quotes quote
    join public.orders target on target.id = quote.order_id
    where quote.expires_at <= p_now
      and target.tender_type = 'square_card'
      and target.status in ('created', 'cancelled')
      and not exists (select 1 from public.platform_fees fee
        where fee.order_id = quote.order_id)
      and not exists (select 1 from app_private.square_attempt_terminal_evidence terminal
        where terminal.order_id = quote.order_id)
      and (quote.cleanup_claimed_at is null
        or quote.cleanup_claimed_at <= p_now - interval '5 minutes')
    order by quote.cleanup_claimed_at asc nulls first,
      quote.expires_at, quote.order_id
    for update of quote skip locked limit p_limit
  ), claimed as (
    update public.platform_fee_quotes quote set
      cleanup_claimed_at = p_now,
      claim_generation = gen_random_uuid()
    from due where quote.order_id = due.order_id
    returning quote.*
  )
  select claimed.order_id, claimed.brand_id, claimed.location_id,
    claimed.expires_at, claimed.claim_generation,
    target.square_order_id, target.square_payment_id,
    claimed.gross_cents, claimed.fee_cents, claimed.fee_bps_applied
  from claimed join public.orders target on target.id = claimed.order_id;
end $$;

-- The caller must first fence the permanent pay-<order UUID> idempotency key
-- through Square CancelPaymentByIdempotencyKey. A provider-bound order must
-- additionally be observed in terminal CANCELED state at the supplied version.
create function public.expire_square_card_quote(
  p_order_id uuid,
  p_claim_generation uuid,
  p_square_order_id text,
  p_provider_order_version bigint,
  p_provider_order_state text,
  p_square_payment_id text,
  p_provider_payment_state text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  quote public.platform_fee_quotes%rowtype;
  target public.orders%rowtype;
begin
  if p_order_id is null or p_claim_generation is null
    or p_square_order_id is null
    or pg_catalog.octet_length(p_square_order_id) not between 3 and 255
    or p_square_order_id ~ '[[:space:]]'
    or p_provider_order_version is null or p_provider_order_version < 0
    or p_provider_order_state is distinct from 'CANCELED'
    or (p_square_payment_id is null and p_provider_payment_state is not null)
    or (p_square_payment_id is not null and (
      pg_catalog.octet_length(p_square_payment_id) not between 3 and 255
      or p_square_payment_id ~ '[[:space:]]'
      or p_provider_payment_state is null
      or p_provider_payment_state not in ('FAILED', 'CANCELED')
    )) then
    raise exception 'square card expiry evidence is invalid';
  end if;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id;
  if quote.order_id is null then
    return exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id and terminal.tender_type = 'square_card'
        and terminal.quote_claim_generation = p_claim_generation
        and terminal.square_order_id = p_square_order_id
        and terminal.provider_order_version = p_provider_order_version
        and terminal.provider_order_state = p_provider_order_state
        and terminal.square_payment_id is not distinct from p_square_payment_id
        and terminal.provider_payment_state is not distinct from p_provider_payment_state
        and terminal.terminal_reason = case when p_square_payment_id is null
          then 'card_attempt_expired' else 'card_payment_terminal' end);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'platform-fee:' || quote.location_id::text || ':'
      || pg_catalog.date_part('epoch', quote.month_start)::text, 0
  ));
  select * into target from public.orders where id = p_order_id for update;
  select * into quote from public.platform_fee_quotes where order_id = p_order_id for update;
  if quote.order_id is null or quote.expires_at > pg_catalog.now()
    or quote.cleanup_claimed_at is null or quote.claim_generation <> p_claim_generation
    or target.id is null or target.tender_type <> 'square_card'
    or target.status not in ('created', 'cancelled')
    or target.square_order_id is distinct from p_square_order_id
    or target.square_payment_id is distinct from p_square_payment_id
    or exists (select 1 from public.platform_fees fee where fee.order_id = p_order_id)
    or exists (select 1 from app_private.square_attempt_terminal_evidence terminal
      where terminal.order_id = p_order_id)
  then return false; end if;
  begin
    insert into app_private.square_attempt_terminal_evidence (
      order_id, brand_id, location_id, connection_id, connection_generation,
      tender_type, square_order_id, square_payment_id,
      payment_idempotency_key, quote_claim_generation,
      pricing_month_start, pricing_month_end, gross_cents, fee_cents,
      fee_bps_applied, provider_order_version,
      provider_order_state, provider_payment_state, terminal_reason
    ) values (
      target.id, target.brand_id, target.location_id, quote.connection_id,
      quote.connection_generation, 'square_card', p_square_order_id,
      p_square_payment_id, 'pay-' || target.id::text, p_claim_generation,
      quote.month_start, quote.month_end,
      quote.gross_cents, quote.fee_cents, quote.fee_bps_applied,
      p_provider_order_version, p_provider_order_state, p_provider_payment_state,
      case when p_square_payment_id is null then 'card_attempt_expired'
        else 'card_payment_terminal' end
    );
  exception when unique_violation then
    return false;
  end;
  delete from public.platform_fee_quotes where order_id = p_order_id;
  if target.status = 'created' then
    insert into public.order_events (brand_id, order_id, type, snapshot, source)
    values (target.brand_id, target.id, 'cancelled',
      target.totals || pg_catalog.jsonb_build_object(
        'reason', case when p_square_payment_id is null
          then 'card_attempt_expired' else 'card_payment_terminal' end,
        'square_order_id', p_square_order_id,
        'square_payment_id', p_square_payment_id,
        'provider_order_version', p_provider_order_version,
        'provider_payment_state', p_provider_payment_state,
        'payment_idempotency_key', 'pay-' || target.id::text
      ), 'job');
  end if;
  return true;
end $$;

create function app.remove_finalized_platform_fee_quote()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.order_id is null then return new; end if;
  delete from public.platform_fee_quotes where order_id = new.order_id;
  return new;
end $$;
revoke all on function app.remove_finalized_platform_fee_quote()
  from public, anon, authenticated, service_role;

create trigger remove_finalized_platform_fee_quote
after insert on public.platform_fees for each row
execute function app.remove_finalized_platform_fee_quote();

delete from public.platform_fee_quotes quote
where exists (select 1 from public.platform_fees fee where fee.order_id = quote.order_id);

create or replace function app.apply_order_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  current_status app.order_status;
  current_tender text;
  current_brand uuid;
  current_square_order text;
  current_square_payment text;
begin
  if new.square_event_id is not null and exists (
    select 1 from public.order_events event
    where event.square_event_id = new.square_event_id
  ) then
    return null;
  end if;
  select target.status, target.tender_type, target.brand_id,
      target.square_order_id, target.square_payment_id
    into current_status, current_tender, current_brand,
      current_square_order, current_square_payment
    from public.orders target where target.id = new.order_id for update;
  if current_status is null then
    raise exception 'order % does not exist', new.order_id;
  end if;
  if current_brand is distinct from new.brand_id then
    raise exception 'order event brand does not match its order';
  end if;
  if new.type = current_status then return new; end if;
  if new.source = 'operator' and new.square_refund_id is null
    and new.type in ('paid', 'cancelled')
    and (current_tender <> 'pay_at_pickup' or current_status <> 'created') then
    raise exception 'operator paid/cancelled requires an unpaid pay-at-pickup order';
  end if;
  if new.source = 'customer' and new.type = 'cancelled'
    and (current_status <> 'created' or current_tender = 'square_link'
      or current_square_payment is not null) then
    raise exception 'customer cancellation is not allowed for this order';
  end if;
  if new.type = 'cancelled' and current_status = 'created'
    and current_tender = 'square_card' then
    if not (new.source = 'job' and exists (
        select 1 from app_private.square_attempt_terminal_evidence terminal
        where terminal.order_id = new.order_id
          and terminal.square_order_id is not distinct from current_square_order
          and terminal.square_payment_id is not distinct from current_square_payment
      )) and (current_square_payment is not null
      or exists (select 1 from public.platform_fee_quotes quote
        where quote.order_id = new.order_id
          and (current_square_order is not null
            or quote.expires_at > pg_catalog.now()
            or quote.cleanup_claimed_at is not null))) then
      raise exception 'square_card_payment_in_flight';
    end if;
  end if;
  if not app.order_transition_allowed(current_status, new.type) then
    if new.source = 'webhook' then
      insert into public.webhook_events (provider, event_id, payload, error)
      values ('square', new.square_event_id, jsonb_build_object(
        'order_id', new.order_id, 'type', new.type, 'snapshot', new.snapshot
      ), format('stale transition %s -> %s ignored', current_status, new.type))
      on conflict (event_id) do nothing;
      return null;
    end if;
    raise exception 'illegal order transition % -> % for order %',
      current_status, new.type, new.order_id;
  end if;
  update public.orders set status = new.type, updated_at = now()
  where id = new.order_id;
  return new;
end $$;
revoke all on function app.apply_order_event()
  from public, anon, authenticated, service_role;

revoke all on function public.claim_square_connection_mutation(
  uuid, uuid, uuid, text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_square_connection_mutation(
  uuid, uuid, uuid, text, uuid, uuid, text, text
) to service_role;
revoke all on function public.finalize_square_connection_replacement(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_square_connection_replacement(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, integer
) to service_role;
revoke all on function public.finalize_square_connection_renewal(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_square_connection_renewal(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz
) to service_role;
revoke all on function public.finalize_square_connection_disconnect(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_square_connection_disconnect(
  uuid, uuid, uuid, uuid, uuid
) to service_role;
revoke all on function public.fail_square_connection_mutation(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_square_connection_mutation(uuid, uuid, uuid, text)
  to service_role;
revoke all on function public.count_square_connection_mutation_alerts()
  from public, anon, authenticated, service_role;
grant execute on function public.count_square_connection_mutation_alerts()
  to service_role;
revoke all on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz,
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.claim_platform_fee_quote(
  uuid, uuid, bigint, integer, integer, bigint, timestamptz, timestamptz,
  uuid, uuid, boolean
) to service_role;
revoke all on function public.release_platform_fee_quote(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_platform_fee_quote(uuid, uuid) to service_role;
revoke all on function public.bind_square_checkout_link(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_square_checkout_link(uuid, uuid, text, text, text)
  to service_role;
revoke all on function public.bind_square_checkout_link_replay(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_square_checkout_link_replay(uuid, text, text, text)
  to service_role;
revoke all on function public.bind_square_payment_attempt(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_square_payment_attempt(uuid, uuid, text)
  to service_role;
revoke all on function public.bind_square_payment(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_square_payment(uuid, uuid, text, text)
  to service_role;
revoke all on function public.finalize_square_card_payment(uuid, uuid, text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_square_card_payment(uuid, uuid, text, text, bigint)
  to service_role;
revoke all on function public.get_square_payment_quote(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_square_payment_quote(uuid, text) to service_role;
revoke all on function public.record_square_payment_settlement(uuid, text, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_square_payment_settlement(uuid, text, text, text, bigint, text)
  to service_role;
revoke all on function public.claim_due_square_checkout_quotes(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_square_checkout_quotes(timestamptz, integer)
  to service_role;
revoke all on function public.expire_square_checkout_quote(uuid, uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_square_checkout_quote(uuid, uuid, text, text, bigint, text)
  to service_role;
revoke all on function public.claim_due_square_card_quotes(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_square_card_quotes(timestamptz, integer)
  to service_role;
revoke all on function public.expire_square_card_quote(
  uuid, uuid, text, bigint, text, text, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_square_card_quote(
  uuid, uuid, text, bigint, text, text, text
)
  to service_role;
revoke all on function public.claim_due_square_payment_remediations(timestamptz, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_due_square_payment_remediations(timestamptz, integer)
  to service_role;
revoke all on function public.finalize_square_payment_remediation(
  uuid, uuid, text, text, text, bigint, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_square_payment_remediation(
  uuid, uuid, text, text, text, bigint, text
)
  to service_role;
revoke all on function public.fail_square_payment_remediation(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_square_payment_remediation(uuid, uuid, text, timestamptz)
  to service_role;
revoke all on function public.count_square_payment_remediation_alerts()
  from public, anon, authenticated, service_role;
grant execute on function public.count_square_payment_remediation_alerts()
  to service_role;
revoke all on function public.process_square_refund(uuid, text, text, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.process_square_refund(uuid, text, text, bigint, text)
  to service_role;

revoke insert, update, delete, truncate, references, trigger
  on table public.platform_fee_quotes, public.platform_fees
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger
  on table public.square_connections
  from public, anon, authenticated, service_role;

create index operation_outbox_sending_due_idx
  on public.operation_notification_outbox (available_at, id)
  where status = 'sending';
create index operation_outbox_claim_due_idx
  on public.operation_notification_outbox (available_at, id)
  where status in ('pending', 'failed') and attempt_count < 20;

create or replace function public.claim_operation_notification_batch(target_limit integer default 50)
returns setof public.operation_notification_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if target_limit is null or target_limit not between 1 and 200 then
    raise exception using errcode = '22023', message = 'notification_batch_limit_invalid';
  end if;
  with disabled as (
    select outbox.id from public.operation_notification_outbox outbox
    where not app.brand_operations_enabled(outbox.brand_id)
      and outbox.status in ('pending', 'failed', 'sending')
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'operations_disabled'
  from disabled where outbox.id = disabled.id;
  with uncertain as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status = 'sending' and outbox.available_at <= now()
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox
    set status = 'cancelled', last_error = 'delivery_uncertain'
  from uncertain where outbox.id = uncertain.id;
  return query with candidates as (
    select outbox.id from public.operation_notification_outbox outbox
    where outbox.status in ('pending', 'failed')
      and outbox.available_at <= now() and outbox.attempt_count < 20
      and app.brand_operations_enabled(outbox.brand_id)
    order by outbox.available_at, outbox.id
    for update of outbox skip locked limit target_limit
  )
  update public.operation_notification_outbox outbox set status = 'sending',
    attempt_count = outbox.attempt_count + 1, last_error = null,
    available_at = now() + interval '5 minutes'
  from candidates where outbox.id = candidates.id returning outbox.*;
end $$;

revoke all on function public.claim_operation_notification_batch(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_operation_notification_batch(integer) to service_role;

create or replace function app.assert_bounded_claim_repairs()
returns void language plpgsql stable set search_path = '' as $$
declare
  claim_proc pg_catalog.pg_proc%rowtype;
  rpc text;
  rpc_proc pg_catalog.pg_proc%rowtype;
begin
  select proc.* into claim_proc from pg_catalog.pg_proc proc
  where proc.oid = pg_catalog.to_regprocedure(
    'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,uuid,uuid,boolean)'
  );
  if claim_proc.oid is null or claim_proc.pronargs <> 11 or claim_proc.pronargdefaults <> 1
    or pg_catalog.pg_get_function_result(claim_proc.oid) <>
      'TABLE(quoted_fee_cents bigint, quoted_fee_bps_applied integer, quote_claim_generation uuid, quote_claim_created boolean)'
    or pg_catalog.to_regprocedure(
      'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz)'
      ) is not null then
    raise exception 'platform fee quote result contract is incomplete';
  end if;
  if not exists (select 1 from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'platform_fee_quotes'
      and column_row.column_name = 'claim_generation'
      and column_row.data_type = 'uuid' and column_row.is_nullable = 'NO'
      and column_row.column_default like '%gen_random_uuid%')
    or pg_catalog.to_regclass('app_private.square_attempt_terminal_evidence') is null
    or pg_catalog.to_regclass('app_private.square_payment_remediation_outbox') is null
    or pg_catalog.to_regclass('public.platform_fees_order_unique_idx') is null then
    raise exception 'platform fee durable fencing objects are incomplete';
  end if;
  foreach rpc in array array[
    'public.claim_square_connection_mutation(uuid,uuid,uuid,text,uuid,uuid,text,text)',
    'public.finalize_square_connection_replacement(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,integer)',
    'public.finalize_square_connection_renewal(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz)',
    'public.finalize_square_connection_disconnect(uuid,uuid,uuid,uuid,uuid)',
    'public.fail_square_connection_mutation(uuid,uuid,uuid,text)',
    'public.count_square_connection_mutation_alerts()',
    'public.claim_platform_fee_quote(uuid,uuid,bigint,integer,integer,bigint,timestamptz,timestamptz,uuid,uuid,boolean)',
    'public.release_platform_fee_quote(uuid,uuid)',
    'public.bind_square_checkout_link(uuid,uuid,text,text,text)',
    'public.bind_square_checkout_link_replay(uuid,text,text,text)',
    'public.bind_square_payment_attempt(uuid,uuid,text)',
    'public.bind_square_payment(uuid,uuid,text,text)',
    'public.finalize_square_card_payment(uuid,uuid,text,text,bigint)',
    'public.get_square_payment_quote(uuid,text)',
    'public.record_square_payment_settlement(uuid,text,text,text,bigint,text)',
    'public.claim_due_square_checkout_quotes(timestamptz,integer)',
    'public.expire_square_checkout_quote(uuid,uuid,text,text,bigint,text)',
    'public.claim_due_square_card_quotes(timestamptz,integer)',
    'public.expire_square_card_quote(uuid,uuid,text,bigint,text,text,text)',
    'public.claim_due_square_payment_remediations(timestamptz,integer)',
    'public.finalize_square_payment_remediation(uuid,uuid,text,text,text,bigint,text)',
    'public.fail_square_payment_remediation(uuid,uuid,text,timestamptz)',
    'public.count_square_payment_remediation_alerts()',
    'public.process_square_refund(uuid,text,text,bigint,text)',
    'public.claim_operation_notification_batch(integer)'
  ] loop
    select proc.* into rpc_proc from pg_catalog.pg_proc proc
    where proc.oid = pg_catalog.to_regprocedure(rpc);
    if rpc_proc.oid is null or not rpc_proc.prosecdef
      or not ('search_path=""' = any(coalesce(rpc_proc.proconfig, '{}'::text[])))
      or pg_catalog.has_function_privilege('anon', rpc, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', rpc, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', rpc, 'EXECUTE') then
      raise exception 'unsafe platform fee RPC contract: %', rpc;
    end if;
  end loop;
  if pg_catalog.to_regprocedure('public.release_platform_fee_quote(uuid)') is not null
    or pg_catalog.to_regprocedure(
      'public.record_square_payment_settlement(uuid,text,text,bigint,text)') is not null
    or pg_catalog.to_regprocedure('public.expire_square_checkout_quote(uuid,text)') is not null
    or pg_catalog.to_regprocedure(
      'public.expire_square_checkout_quote(uuid,uuid,text,text)') is not null
    or pg_catalog.to_regprocedure(
      'public.expire_square_card_quote(uuid,uuid,text)') is not null then
    raise exception 'an unfenced platform fee RPC remains installed';
  end if;
  if exists (select 1 from pg_catalog.pg_index index_row
    where index_row.indexrelid in (
      'public.platform_fee_quotes_cleanup_queue_idx'::regclass,
      'public.operation_outbox_sending_due_idx'::regclass,
      'public.operation_outbox_claim_due_idx'::regclass,
      'public.platform_fees_order_unique_idx'::regclass,
      'app_private.square_attempt_terminal_payment_idx'::regclass,
      'app_private.square_attempt_terminal_link_idx'::regclass,
      'app_private.square_payment_remediation_due_idx'::regclass,
      'app_private.square_connection_mutation_alert_idx'::regclass,
      'public.square_connections_generation_idx'::regclass,
      'public.platform_fees_location_month_idx'::regclass
    ) and (not index_row.indisvalid or not index_row.indisready)) then
    raise exception 'a bounded fee claim index is not valid and ready';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.platform_fees'::regclass
      and trigger_row.tgname = 'remove_finalized_platform_fee_quote'
      and not trigger_row.tgisinternal and trigger_row.tgenabled <> 'D'
      and trigger_row.tgtype = 5
      and trigger_row.tgfoid = 'app.remove_finalized_platform_fee_quote()'::regprocedure) then
    raise exception 'finalized platform fee quote cleanup trigger is incomplete';
  end if;
  if claim_proc.prosrc !~ 'quote_claim_generation := null'
    or claim_proc.prosrc !~ 'existing.expires_at <= pg_catalog.now'
    or claim_proc.prosrc !~ 'not between 0 and 9000'
    or (select proc.prosrc from pg_catalog.pg_proc proc
      where proc.oid = 'public.bind_square_payment_attempt(uuid,uuid,text)'::regprocedure)
        !~ 'quote.expires_at <= pg_catalog.now'
    or (select proc.prosrc from pg_catalog.pg_proc proc
      where proc.oid = 'app.apply_order_event()'::regprocedure)
        !~ 'square_attempt_terminal_evidence' then
    raise exception 'platform fee ownership or cancellation fence is incomplete';
  end if;
  if pg_catalog.has_table_privilege('service_role',
      'app_private.square_attempt_terminal_evidence', 'SELECT')
    or pg_catalog.has_table_privilege('service_role',
      'app_private.square_attempt_terminal_evidence', 'INSERT')
    or pg_catalog.has_table_privilege('service_role',
      'app_private.square_payment_remediation_outbox', 'SELECT')
    or pg_catalog.has_table_privilege('service_role',
      'app_private.square_payment_remediation_outbox', 'INSERT')
    or pg_catalog.has_table_privilege('service_role',
      'app_private.square_connection_mutation_fences', 'SELECT')
    or pg_catalog.has_table_privilege('service_role',
      'app_private.square_connection_mutation_fences', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.platform_fee_quotes', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.platform_fee_quotes', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.platform_fees', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.platform_fees', 'DELETE')
    or pg_catalog.has_table_privilege('service_role', 'public.square_connections', 'INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.square_connections', 'UPDATE')
    or pg_catalog.has_table_privilege('service_role', 'public.square_connections', 'DELETE') then
    raise exception 'platform fee direct table privileges are unsafe';
  end if;
end $$;
revoke all on function app.assert_bounded_claim_repairs()
  from public, anon, authenticated, service_role;
grant execute on function app.assert_bounded_claim_repairs() to service_role;

select app.register_release(
  '20260908227000', 'repair bounded quote and notification claims',
  'app.assert_bounded_claim_repairs()'::regprocedure
);
