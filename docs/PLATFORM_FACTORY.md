# Platform factory: clone to live

![Platform factory flow](./assets/platform-factory-flow.svg)

The canonical model is **one isolated GitHub/Supabase/Vercel stack per tenant brand**,
created from a shared, versioned industry blueprint. This gives each franchise a
separate failure, billing, credential, and data boundary while shared packages and
templates preserve one upgrade path. A materially different industry changes its
blueprint and vocabulary, not the tenant-safe runtime contracts.

The HQ **Settings → Onboarding** page is the operator surface. It creates a private,
idempotent run in hosted Supabase, exposes reviewed credential walkthroughs, and
advances through research, demo, access, infrastructure, content, canary, and live
stages. Paid resources and external accounts are never created before the credential
gate. Failed validation leaves the previous release active.

## What is automated

1. Validate an industry blueprint and tenant intake.
2. Research public brand facts and prepare draft assets with source/rights metadata.
3. Build and verify a private five-surface demo.
4. Pause for the human-owned account access that cannot legally be automated.
5. Create or select the GitHub repository, Doppler project/configs, hosted Supabase
   project, and five Vercel projects.
6. Apply migrations, seed the tenant overlay, upload immutable media, and publish
   catalog/training releases atomically.
7. Verify customer → operator → pickup order propagation and HQ editing in canary.
8. Promote only after all required gates pass; otherwise roll back to last known good.

The durable executor currently completes steps 1–5. It then records
`content_bootstrap_required` and stops before any public release. Steps 6–8 remain in
the persisted task graph so a partial run is visible and resumable, but they must not
be represented as complete until the migration/seed, canary, and promotion executors
are connected and verified.

The workflow `.github/workflows/deploy-hosted.yml` accepts `tenant`, `project_prefix`,
and `environment`. Coffee Story remains the default, so existing deployment commands
keep working. New stacks use `<project_prefix>-hq`, `-customer`, `-operator`, `-kiosk`,
and `-display`.

## Secret architecture

- Doppler is the authoring/control-plane store for platform and provider secrets.
- Supabase Vault stores runtime connector secrets that server-side database workflows
  must resolve.
- Public Supabase tables store only opaque secret references and verification state.
- Vercel receives the smallest environment-specific subset needed by each project.
- Native/public prefixes contain only publishable configuration.
- Apple, Google Play, and Expo credentials remain in client-owned accounts; the client
  grants a scoped role instead of sharing a personal password.

Use the variables in `.env.example`. Production runtimes use Doppler service tokens,
which are restricted to one config; Doppler explicitly recommends them over personal
tokens for live environments. See the [Doppler service-token guide](https://docs.doppler.com/docs/service-tokens).

## Credential walkthroughs

### GitHub

Owner: platform. Create a GitHub App with the minimum repository administration and
contents permissions needed to create/configure the cloned repository, plus Actions,
Actions secrets, and Actions variables write access for the encrypted deployment
handoff. Install it only
on the template organization or selected repositories. GitHub Apps start with no
permissions, and GitHub recommends selecting only what is required. Store the app ID,
installation ID, and private key in Doppler—not in GitHub variables or tenant folders.
Also configure `GITHUB_REPOSITORY_OWNER`, `GITHUB_TEMPLATE_OWNER`, and
`GITHUB_TEMPLATE_REPOSITORY`; the template repository must be marked as a GitHub
template and the Vercel GitHub App must be allowed to read generated repositories.
The factory writes only the names of synchronized secrets to its audit metadata; values
are sealed with the repository public key before GitHub receives them.
[Official GitHub permissions guide](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

### Doppler

Owner: platform. Create a `platform-factory` project with `dev`, `preview`, and
`production` configs. The factory uses a service-account token to create tenant-scoped
projects/configs; deployed apps use read-only service tokens for a single config. Copy
each one-time token directly into the destination secret store.
Set `DOPPLER_PRODUCTION_CONFIG` only when the workplace does not use the default
`prd` root config.
[Official Doppler service-token guide](https://docs.doppler.com/docs/service-tokens).

### Supabase

Owner: platform or client organization. Use a fine-grained Management API token with
project-creation access for the selected organization. Project creation requires a
database password; generate it in the workflow and store it immediately in Doppler as
`SUPABASE_DB_PASSWORD` for initial project creation and emergency direct access.
Never copy that password into GitHub Actions or Vercel. Deployments use the Management
API token instead. Supabase deliberately does not return
the production database password later. Never return it to a browser or persist it in
the control-plane tables. The Management
API is rate-limited, so the factory tasks use bounded retries and idempotency.
[Official Supabase Management API](https://supabase.com/docs/reference/api/getting-started).

### Vercel

Owner: platform. Create a scoped team access token, record the team/scope ID, and allow
the factory to create five projects and environment variables. Environment changes
apply only to new deployments, so every secret/config change must be followed by a
canary rebuild before promotion. [Official Vercel REST API](https://vercel.com/docs/rest-api)
and [environment-variable guide](https://vercel.com/docs/environment-variables).

### Apple App Store

Owner: client Account Holder. The client enrolls its organization, accepts agreements,
creates the explicit App ID, and invites the release operator. Prefer an App Store
Connect API key over an app-specific password; Apple shows a private key only once, so
place it directly in the client-owned Expo/EAS credential store. The Account Holder
must request API access before keys can be generated.
[Official App Store Connect API setup](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api).

### Google Play

Owner: client Account Holder. Use an organization developer account, enable the Google
Play Developer API, create a service account, and invite that service-account email in
Play Console with access limited to the specific branded application. Google recommends
a service account for secure server-to-server publishing.
[Official Google Play Developer API setup](https://developers.google.com/android-publisher/getting_started).

### Expo/EAS

Owner: client organization. The branded customer app and kiosk use separate EAS project
IDs; the operator remains the shared staff app. Prefer EAS-managed signing credentials.
Expo recommends App Store Connect API keys for iOS submissions and keeps managed
credentials encrypted. [Expo credential security](https://docs.expo.dev/app-signing/security/)
and [store submission guide](https://docs.expo.dev/deploy/submit-to-app-stores/).

### Square

Owner: client. Square connects per location by OAuth from the HQ console
(Locations → Connect Square), so the client authorises their own seller account
and the platform never holds their password. The factory needs the application
half only: `SQUARE_APP_ID` and `SQUARE_APP_SECRET` from the developer dashboard,
plus `SQUARE_ENV` (`sandbox` or `production`).

Two of these are not from Square and are the ones most often missed.
`SQUARE_TOKEN_KEY` is 32 random bytes you generate (`openssl rand -base64 32`);
it encrypts the per-location OAuth tokens at rest, so losing it means every
location must reconnect, and rotating it means re-encrypting them.
`SQUARE_WEBHOOK_URL` must match the URL Square is configured to call **exactly**
— the signature is computed over it, so a trailing slash is a failed
verification, not a warning.

Setup required state: with no application credentials the Connect button is the
only thing that does not work; ordering, the board and the display all run.
Payments are what stop. [OAuth API](https://developer.squareup.com/docs/oauth-api/overview),
[webhook signature validation](https://developer.squareup.com/docs/webhooks/step3validate).

### OpenAI

Owner: platform. A project API key, scoped to the factory's project so its spend
and its blast radius are separable from anything else on the account. Set
`OPENAI_API_KEY` with `OPENAI_RESEARCH_MODEL` and `OPENAI_EVALUATION_MODEL`;
naming the models explicitly is what keeps a provider default from silently
changing what the research step produces.

Setup required state: two different behaviours, deliberately. Brand research in
the factory treats the key as optional and a failed run never replaces the
published catalog or training release — the tenant keeps what it had. Training
bootstrap treats it as required and fails fast naming the variable, because a
training release generated without it would be empty rather than stale.
[Production best practices](https://platform.openai.com/docs/guides/production-best-practices);
keys are created in the OpenAI console under **API keys** for the selected
project.

### Email and SMS

Owner: platform, sending on the tenant's behalf from a verified domain or
number. The engine has exactly two transports and reads nothing else:
Resend (`RESEND_API_KEY`, `RESEND_FROM`) and Twilio (`TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`). Use a Twilio API key rather than the
account auth token where the account allows it — it can be revoked without
resetting everything else.

SendGrid appears in the Integrations catalog and is **not** one of these. It is
a connector, authorised in HQ and stored in Vault, and the engine has no
SendGrid transport at all, so setting `SENDGRID_API_KEY` in the environment
configures nothing. Email through the engine means Resend.

Setup required state: each transport throws naming the variables it wants, so a
half-filled block fails loudly at send rather than dropping messages silently.
[Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction),
[Twilio API keys](https://www.twilio.com/docs/iam/api-keys).

### Monitoring

Owner: platform. `SENTRY_DSN` is server-side for the console; the apps carry
their own `EXPO_PUBLIC_SENTRY_DSN` per app environment, which is public by
definition and must not be a token. `SENTRY_AUTH_TOKEN` is build-time only — it
uploads source maps — and belongs in CI, never in a runtime environment.
`SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_DISPLAY_PROJECT` route the two web
surfaces to their own projects.

Setup required state: DSN-gated and silent. Without `SENTRY_DSN` instrumentation
is a no-op and the build stays self-contained — nothing fails, so nothing tells
you errors are going unreported. Treat a missing DSN as a deployment defect
rather than a default. [Sentry auth tokens](https://docs.sentry.io/account/auth-tokens/).

### Connector approvals

Owner: client, granted through HQ. Everything in the Integrations catalog —
Google, Stripe Connect, QuickBooks, Plaid, Slack, SendGrid — is authorised at
**Integrations → Connect** rather than by an environment variable. The
credential goes to Supabase Vault; the public tables hold an opaque reference
and verification state, and a card's status is read from its
`connector_installations` row.

This is why the optional provider block in `.env.example` enables nothing:
filling in `STRIPE_SECRET_KEY` there does not install a connector, and the
catalog will still report **Setup required**, correctly. The environment names
are listed only as the names to use if one of those providers is ever wired up
directly.

Setup required state: the honest default. A connector with no installation row
reports Setup required whatever is in the environment, and the platform runs
without it. [Supabase Vault](https://supabase.com/docs/guides/database/vault).

## Tenant and industry file boundaries

`industries/<key>/blueprint.json` contains reusable vocabulary and template version.
`tenants/<slug>/` contains only portable brand inputs. Generated app files are build
artifacts; hosted Supabase is the source of truth once the tenant is live. Do not create
tenant-specific source forks. Every database row, storage path, analytics event,
connector installation, and release carries the tenant/brand boundary.

## Operator checklist

- Create the private run in HQ and approve researched brand facts/media rights.
- Verify each credential card; never paste secrets into notes or source files.
- Run hosted migration dry-run, push, and remote schema lint.
- Dispatch `deploy hosted surfaces` with the run's tenant and project prefix.
- Verify the five-app wall, realtime order flow, catalog/training publication, RLS
  isolation, accessibility, error monitoring, and rollback.
- Enable native publishing only after the client store accounts and legal agreements are
  ready. Missing access stays `Setup required`; it never reports a false production pass.

## Billing contract encoded by the factory

- First 30 days: $0 setup and $0 platform fee; 2% app-order commission.
- Initial location: $5,500 paid in full or $600/month for 12 months; financing still
  carries the separate $249/month platform fee after the trial.
- Commission is marginal per location/calendar month: 2% through $25,000 of app-order
  gross and 1.5% only above it.
- Additional location: $2,500 setup plus $299/month and the same commission schedule.
- Day-90 guarantee: if app gross is under 10% of total Square gross, cancel remaining
  setup installments and credit setup already paid. Authoritative commerce records—not
  behavioral telemetry—drive the calculation.
