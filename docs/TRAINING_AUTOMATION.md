# Tenant training automation

The training bootstrap is vendor-neutral at its boundary. Claude Code,
ChatGPT, Codex, Kimi Code, CI, or a human operator can invoke the same HTTPS
API or JSON-producing CLI without editor-specific commands.

## Required environment

- HQ: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and
  `OPENAI_RESEARCH_MODEL`.
- Optional: `OPENAI_EVALUATION_MODEL`; when omitted, the research model also
  performs the independent release review.
- CLI: `PLATFORM_API_URL` and a manager's `TENANT_ACCESS_TOKEN`.

The research model stays in environment configuration so changing providers
or model versions does not require a tenant build. Requests have a 45-second
timeout and retry once; the durable workflow separately retries failed steps.

## Start or resume an empty tenant

```bash
PLATFORM_API_URL=https://hq.example.com \
TENANT_ACCESS_TOKEN="$TOKEN" \
pnpm training:bootstrap \
  --profile tenants/coffee-story/training-profile.json \
  --wait
```

Use `--force` only when a manager intentionally wants a new release. Normal
runs are idempotent by tenant profile fingerprint and pipeline version.

## Agent/API contract

`POST /api/training/bootstrap`

```json
{
  "profile": {
    "businessName": "Coffee Story",
    "industry": "Specialty coffee shop",
    "locale": "en-US",
    "products": ["espresso drinks"],
    "services": ["counter service"],
    "complianceTopics": ["food safety"]
  },
  "force": false
}
```

Send a tenant-owner or platform-admin token as `Authorization: Bearer …`. The response is
JSON and includes the platform run id. Poll
`GET /api/training/bootstrap/{runId}` for `queued`, `researching`,
`validating`, `published`, or `failed`.

Staff clients read only their tenant's published release through RLS or
`GET /api/training`. Quiz answer keys, drafts, failed runs, and other tenants
remain unavailable. Each lesson cites its published sources. A release is
published only after structural and URL-safety gates plus an independent
claim, safety, media, rights-note, and quiz review pass.

Manifest v3 always includes the five core tracks in this order: knowledge,
skills, service, safety, operations. A track is addressed by its slug and
nothing else; a tenant may add tracks of its own, and any slug outside those
five sorts after them. Releases stored as v1 or v2 spell the array `modules`
rather than `tracks` and may carry a retired per-track `trackKey`; they are
lifted on read and become v3 the next time HQ saves them.

The existing `/api/jobs/run` Vercel cron checks tenant training profiles every
five minutes. It starts at most two durable bootstraps per tick when a tenant
has no release for the current profile fingerprint, so a new tenant or a
changed industry profile self-heals without an editor-specific agent session.

## Tenant handoff

Every tenant keeps its inputs in `tenants/<slug>/training-profile.json`.
Brand-specific wording, researched media links, quiz content, and icon
manifests live in the published release, not in the operator UI. The same app
binary therefore changes industries by login and tenant data rather than by
forking screen code.

Icons use portable semantic symbols rendered by the app's bundled icon set;
the automation does not download executable or tenant-controlled UI assets.

## HQ authoring and media history

Tenant owners use HQ → Training to edit all five core tracks and any tracks of
their own, lesson copy, image/video references, sources, quizzes, and answer
explanations. A core track's slug is fixed in the editor: renaming it would
orphan the progress rows and competency awards already filed under it.
Draft answer keys remain server-only; publication atomically retires the prior
release and exposes only the answer-free manifest to operator apps.

Reusable industry templates are stored as versioned `training_templates` rows.
The Coffee Story baseline can be seeded with `pnpm
training:seed-coffee-story`; other tenants inherit the same track structure and
overlay their products, services, compliance topics, voice, and media.

Uploaded track and lesson artwork is stored under tenant-prefixed, immutable
keys in `training-media`. Publishing or updating a draft records every track
icon and lesson media URL in `content_media_versions`, keyed by the portable
track/lesson slug and release metadata. The ledger's `entity_type` values stay
`training_module` and `training_lesson`: those are schema literals shared with
the catalog tables, not the manifest's vocabulary. External HTTPS videos remain links and
carry a rights note; they are never copied into Storage without tenant rights.
