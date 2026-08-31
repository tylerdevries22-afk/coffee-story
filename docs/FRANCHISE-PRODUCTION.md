# Franchise production contract

The platform now has one explicit tenant boundary for ordinary users and one
small, audited boundary for trusted cross-tenant work. Production releases
remain blocked until a client or account owner supplies evidence for the parts
that source code cannot complete.

## Delivered control plane

- Staff invitations resolve an exact email only on the server through Supabase
  Auth Admin. Membership changes use `manage_brand_member`; it rejects platform
  role grants, requires locations for managers/staff, preserves a final owner,
  and has a database trigger proving every location belongs to the brand.
- Add Location continues on one page into a one-time kiosk/display pairing
  code. Square consent remains available for the session's home organization;
  cross-tenant setup is explicitly deferred instead of borrowing credentials.
- Menu import accepts reviewed CSV or an 8 MB maximum PDF/JPEG/PNG/WebP. The
  model sees the source as untrusted transcription material, emits a strict
  schema, and never writes directly. A person reviews the CSV, then one signed,
  transactional RPC validates and imports at most 500 rows.
- Platform operators may operate as another brand only after an append-only
  access event is written. Trusted writers re-check the actor in PostgreSQL and
  receive both brand and location identifiers. Brand settings, kiosk config,
  content authoring, operations, devices, Square, staff, menu, locations, and
  fee mutations all use that boundary.
- Location fee overrides remain platform-admin-only commercial terms. Their
  service-only RPC verifies the human platform actor in PostgreSQL, filters by
  both `locations.id` and `locations.brand_id`, validates the fee bounds,
  requires a returned-row proof, and is preceded by a required audit event.
- Organization creation remains platform-admin-only. Creating a legal tenant
  affects provider ownership, billing, data processing, and support liability;
  a brand owner may operate existing brands but cannot mint another tenant.
  Relaxing this is a future commercial-policy decision, not a convenience flag.

## Service-role model

Supabase's service role is project-wide and deliberately cannot be made into a
row-level “service role per location.” Deployments created by Platform Factory
receive an isolated Supabase project and secret set per tenant. In a shared
project, service-role use is limited to server-only modules and guarded again by
database functions that verify the human platform actor, target brand, target
location, input size/shape, and secret-free metadata. Browser bundles receive
only publishable keys.

This distinction is intentional: tenant/location authorization is RLS plus the
signed user's claims; the service role is a narrowly scoped implementation tool,
not an identity presented as a franchise user.

## Logo, assets, and EAS

`pnpm onboard --tenant <slug> --apply` validates tenant data, turns
`assets/logo.svg` into the customer/kiosk icon, adaptive icon, monochrome icon,
favicon, and splash assets, emits listing/checklist drafts, and materializes the
tenant bundle used by Metro. The hosted deployment workflow runs the same
command and requires a clean diff before production. Native OTA publication
then uses the tenant's customer and kiosk EAS project UUIDs. A missing UUID,
stale generated asset, or uncommitted tenant bundle blocks the release.

## Preview tenant directory

Customer, kiosk, and pickup display previews can link between separately built
tenant previews. They never alter claims or inject another brand config into a
running production binary. Set `PREVIEW_DIRECTORY` as a GitHub repository
variable; preview deployments expose it as the appropriate public environment
variable:

```json
[
  {
    "slug": "coffee-story",
    "label": "Coffee Story",
    "urls": {
      "customer": "https://coffee-customer-preview.example.com",
      "kiosk": "https://coffee-kiosk-preview.example.com",
      "display": "https://coffee-display-preview.example.com"
    }
  }
]
```

Only HTTPS destinations (plus localhost HTTP for development), at most twelve
tenants, are accepted. The customer switcher is web-preview-only. Kiosk uses it
on unattended preview surfaces, while the pickup display renders plain links.
The operator app retains its real authenticated switcher.

## Production release evidence

Each tenant owns `tenants/<slug>/release.json`. Run:

```sh
pnpm release:gate --tenant <slug>
```

The gate requires current official evidence that the App Store Expo Go build is
compatible with this repository's deliberate SDK 54 pin, valid customer and
kiosk EAS UUIDs, and an approval record (`approvedBy`, `approvedAt`, HTTPS
`evidenceUrl`) for all five areas:

1. production credentials;
2. provider accounts;
3. legal and privacy terms;
4. store listings;
5. client-confirmed commercial configuration.

The repository's GitHub `production` environment must require designated
reviewers before `deploy-hosted.yml` can leave its release-policy job. Set
`SUPABASE_PROJECT_REF` to the canonical production project and
`SUPABASE_PREVIEW_PROJECT_REF` to a separate non-production project. The
workflow rejects preview-to-production and production-to-preview database
targets before verification or migration starts. An explicit dispatch value
must exactly match the repository variable for its environment, so it cannot
redirect a deployment to an arbitrary accessible project.

The August 31 check used the official Expo SDK 54 documentation. It expires
after 45 days, forcing the App Store assumption to be checked again near every
release. The current tenant manifests intentionally say `pending` for external
approvals; changing them to `approved` without real evidence defeats the gate
and is not a code task.

## Remaining work outside the repository

- The account owner must provision/verify production Supabase, Vercel, EAS,
  Square, email, domain, and store-provider accounts and record evidence URLs.
- Counsel/client stakeholders must approve the hosted privacy/legal text and
  data-processing posture.
- App Store/Play listing text, screenshots, review answers, and agreements must
  be approved in the provider consoles.
- The client must sign off fee schedules, settlement ownership, refunds,
  support contacts, taxes, operating hours, and enabled features.

Those are hard blockers in `release.json`; none are represented as completed by
this change set.

## Repository-wide audit record

The August 31 pass covered every tracked TypeScript/JavaScript source file,
every migration, every workflow, every tenant manifest, all privileged HQ
writes, raw `fetch` sites, unsafe-suppression markers, and the complete branch
graph. The actionable results are:

- No unmerged remote task branch exists: `main`, `dev`, and this change started
  at the same commit. The feature branch is therefore the only patch set to
  reconcile, and `dev` can be advanced to the resulting `main` without another
  merge.
- No `@ts-ignore`, unexplained TypeScript `any`, unresolved TODO/FIXME/HACK
  marker, vulnerable production dependency, or unbounded external HTTP writer
  was found. Local asset reads and same-origin preview polling are not external
  API calls; external calls use the shared timeout/retry contracts.
- Service-role use is server-only. Public application APIs authenticate and
  derive tenant/location claims before calling trusted engines. Cross-tenant HQ
  mutations additionally use `authorizeWorkspaceMutation`; config, membership,
  fee, and audit writes have guarded database functions. Provisioning scripts
  remain intentionally project-wide and require explicit server credentials.
- The repository still contains 112 hand-maintained, non-test source files over
  the 200-line policy (40,891 lines total after excluding generated workflow
  output, generated schema, fixtures, builds, and dependencies). The largest
  seams are `packages/engine/src/orders.ts`, customer home/order screens,
  `scripts/onboard.ts`, the operator order board/store, and HQ content actions.
  Splitting all of them is a separate refactor program: doing it inside a
  tenant-security release would materially enlarge risk without changing the
  controls shipped here. Newly added modules are under 200 lines; customer and
  kiosk telemetry plus location device actions were extracted during this pass.
- Home-tenant owner mutations verify current database membership in addition to
  signed claims, and every service-role writer verifies the exact immutable
  access event immediately at its database boundary. Demotion therefore closes
  privileged mutation paths without waiting for an already-issued JWT refresh.
- The remaining product risks are the external release approvals listed above
  and the deliberate SDK 54 dependency on the current App Store Expo Go build.
  The release gate makes the latter assumption expire after 45 days.

Recommended follow-up refactor order is: split the order engine behind its
existing public contract and state-machine tests; decompose customer/operator
screens into view-model hooks and sections; split HQ content actions by menu,
catalog, media, and training; then split onboarding/provider orchestration.
Each step should preserve public exports and land independently behind the full
workspace verification gate.
