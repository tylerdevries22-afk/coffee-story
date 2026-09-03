# Tenant isolation audit — adversarial

Produced 2026-08-29 against a disposable hosted Supabase branch cloned from
production (`verify-20260829190000`, deleted after the run). Two brands were
seeded, `fk-test-a` and `fk-test-b`, and every probe below was executed as a
real `authenticated` session — `set role authenticated` plus a
`request.jwt.claims` payload of the shape the policies actually read,
`app_metadata.{brand_id, role, location_ids}`.

The point of running it that way is that RLS is measured rather than assumed.
A probe run as service role proves nothing about a policy.

**Every attack listed here was blocked, and every control listed here
succeeded.** The controls are the load-bearing half: a denial only means
something if the same statement shape against the attacker's own brand goes
through. Three probes in the first pass were discarded rather than counted,
because they failed on a NOT NULL column or malformed JSON before reaching the
security boundary — a statement that never reached a policy is not evidence
that the policy holds.

## Read isolation

Every RLS-enabled table in `public` carrying a `brand_id` — 100 of them,
enumerated from `pg_class` rather than by hand so nothing was missed — was
counted for brand B's rows from a brand A staff session.

**Zero rows visible on every table.** 29 tables did not even reach the count,
failing `42501` because `authenticated` holds no grant on them at all —
`square_connections`, `credential_references`, `push_tokens`,
`analytics_events_*`, `operation_*`. Not being grantable is a stronger
position than being filtered.

## Write isolation

As a **staff** user of brand A:

| Probe | Result |
| --- | --- |
| Insert an order under brand B | blocked `42501`, orders policy |
| 86 one of brand B's menu items | no rows matched |
| Insert an order under own brand, at brand B's **location** | blocked `42501` |
| Insert a recipe under own brand, pointing at brand B's **menu item** | blocked `42501` |
| Insert a prep batch under own brand, pointing at brand B's **recipe** | blocked `23503`, composite FK |
| Plant a chosen `refresh_secret_hash` on own device | blocked `P0001`, lifecycle guard |
| Bump own device's `token_version` | blocked `P0001` |
| Repoint own device at brand B | blocked `P0001` |
| Create a location under brand B | blocked `42501` |
| Create a location under own brand | blocked `42501` — staff may not, by design |
| *Control:* rename own device's label | **wrote 1** |
| *Control:* prep batch against own recipe | **wrote 1** |

The device controls matter: the same `update public.devices` that is refused
for `refresh_secret_hash`, `token_version` and `brand_id` succeeds for
`label`, so the guard is discriminating between columns and not simply hiding
the row.

As a **brand_owner** of brand A — the higher-privilege attacker, since staff
turned out to be heavily restricted on its own:

| Probe | Result |
| --- | --- |
| 86 brand B's menu items | no rows matched |
| Order under own brand at brand B's location | blocked `42501` |
| Recipe under own brand pointing at brand B's menu item | blocked `23503`, composite FK |
| Prep batch under own brand pointing at brand B's recipe | blocked `23503`, composite FK |
| Rename brand B | no rows matched |
| Create a location under brand B | blocked `42501` |
| *Control:* create a location under own brand | **wrote 1** |
| *Control:* recipe against own menu item, same version | **wrote 1** |

The owner recipe probe was re-run before being counted. Its first form was
refused by `recipes_menu_item_id_version_key`, a uniqueness collision that
would have masked whether the tenancy constraint fired at all; with a
non-colliding version it fails on `recipes_menu_item_id_fkey`, and the same
insert against the brand's own item succeeds.

## The defect this pass found

`app.prep_batch_clears_86` is SECURITY DEFINER. It walks
`prep_batches.recipe_id → recipes.menu_item_id → menu_items` and clears
`is_86d` — the write that puts a sold-out item back on sale. Neither foreign
key carried `brand_id`, and `prep_batches_insert`'s WITH CHECK validated only
the row being written, not what it pointed at. A writer could therefore name
another brand's recipe and un-86 that brand's item.

Fixed in `20260829190000_tenant_scoped_recipe_references.sql` by making both
edges composite — `(recipe_id, brand_id)` and `(menu_item_id, brand_id)` —
which holds for **every** writer including the service role, where a policy
predicate would not.

That is not a new invention. `catalog_nodes`, `catalog_placements`,
`catalog_relations` and `catalog_resources` already reference `catalogs` on
`(catalog_id, brand_id)`, which is why `app.bump_catalog_draft` is safe
despite never mentioning `brand_id` itself. The recipe path was the gap in a
pattern the schema already had.

## Systemic finding — not fully remediated

Of 171 foreign keys in `public` where **both** the child and the parent carry
`brand_id`, **34 omit `brand_id` from the constraint**. Each is a place where
the same confused-deputy shape could appear if a SECURITY DEFINER function or
a service-role path is later written against it.

Nothing exploitable was found on the other 33 today. Of the 15 SECURITY
DEFINER trigger functions, 14 follow a `new.<x>_id`; 12 carry `brand_id` in
their own predicate, the catalog family is covered by the composite FKs above,
and `prep_batch_clears_86` was the exception. So this is recorded as latent
risk in the schema rather than a live vulnerability: the guarantee currently
rests on each function remembering to scope itself, and the composite FK is
the version of that guarantee which cannot be forgotten.

Closing the remaining 34 is mechanical but not free — each needs a unique
`(id, brand_id)` on the parent and a constraint swap, and each is a migration
against live tables. It is worth doing deliberately rather than in the same
pass as a release.

## Advisors

`assertAdvisorsClear` ran as part of `pnpm supabase:promote` against the
branch after the migration: **zero WARN and zero ERROR** for both the security
and performance advisors. Production's own advisors report 4 security findings
and 384 performance findings, all INFO. The 4 are `rls_enabled_no_policy` on
`operation_action_receipts`, `operation_notification_outbox`,
`platform_billing_webhook_events` and `platform_factory_audit_events` — all
four with `(none)` client grants, which is deny-all by construction and
consistent with the read sweep above.

## What this pass does not cover

- Storage bucket policies, CORS, rate limits, webhook signature verification
  and OAuth state/PKCE were **not** exercised here.
- No probe was run as `anon`, only as `authenticated`.
- The seeded brands carried a small number of rows; this measures whether a
  boundary holds, not how it behaves under production data volume.

## The anonymous read sweep (20260903230000)

The gap named above — "no probe was run as `anon`" — was closed by reading the
net grant picture out of the migration set rather than off a database. 0014
set `alter default privileges in schema public grant select on tables to anon`
and nothing since revoked it broadly, so the working assumption is that `anon`
holds SELECT on every table in `public` and RLS is the only gate. Four tables
paired that grant with a policy that admits anyone:

| relation | policy | net effect for `anon` | resolution |
| --- | --- | --- | --- |
| `catalog_releases` | `status = 'published' or is_brand_owner(...)` | every brand's published `manifest`, plus `created_by` | grant removed; guest read moved to `public.published_catalog_lookup(uuid)` |
| `catalog_publications` | `using (true)` | every brand's publish history | narrowed to `brand_id` |
| `brand_config_signals` | `using (true)` | every brand's configuration cadence | narrowed to `brand_id` |
| `location_setting_signals` | `using (true)` | every location, and the brand owning it | narrowed to `location_id` |

The two other relations granted to `anon` in the audit list were already
closed: `board_tickets` gates itself on `app.can_read_board()`, which no
claimless caller satisfies, and `kiosk_receipts` was dropped by 0042.

Three of the four are in `supabase_realtime`, so a blanket revoke would have
taken live configuration updates off every deployed kiosk, customer app and
pickup display without an error anywhere. Realtime checks visibility by
primary key, refuses a subscription filtering on a column the role cannot
read, and omits from the payload every column the role has no privilege on —
so the primary key, which the client filters on and already knew, is the whole
requirement. Column grants, not policies, are what that argument reduces to.

### Residual

`anon` can still count the rows in the three signal tables and read their
opaque keys. That residual is bounded by `public.locations`, whose
`locations_select` is `using (true)` by the deliberate decision recorded in
0040 — a shop's name and address are storefront data — and which therefore
already publishes the same brand and location identifiers, under names, to any
holder of the publishable key. **`public.locations` is now the platform's
widest anonymous enumeration surface**, and narrowing the signal keys is only
worth doing after it moves behind a lookup. That is a change to roughly
twenty-nine call sites across `apps/hq`, `apps/operator`, `apps/customer`,
`apps/kiosk`, `apps/display`, `packages/data` and `packages/engine`, only
three of which are anonymous, and it deserves its own pass.
