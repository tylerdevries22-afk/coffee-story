# Coffee Story — franchise MCP host adopt plan (2026-09-11)

**Status:** draft / phase 2 prep  
**Related audits:** `_agent-data/audits/mcp-storage-crossapp-20260911`, `mcp-hosts-sync-20260911`, `mcp-hosts-adopt-20260911`

## Current pins

| Location | Value |
| --- | --- |
| Prior | GitHub Release tarball `v1.3.0` |
| This PR (interim) | `github:…/franchise-mcp-store-ui#9734ee3…` (same tip Elevate already uses) |
| Target after package release | Tarball `v1.3.1` via `franchise-mcp-store-ui` `sync-hosts` |

Rationale: `v1.3.0` tarball lacks the portable React return-types fix (`9734ee3`). No `v1.3.1` tag exists yet. Interim github-commit pin unblocks UI alignment without cutting a release in this PR. After `v1.3.1`, flip back to **release-tarball** style (see package `hosts.json`).

Lockfile: refresh `apps/hq/package-lock.json` before merge (`npm install` in `apps/hq`).

## PKCE-in-cookie gap (do not “fix” carelessly)

Package contract (`docs/adoption.md`): **never** put the code verifier in the OAuth cookie; store it in Vault (or secret manager) and keep only a UUID ref on the oauth transaction; cookie carries **binding only**.

Coffee Story today (`apps/hq/app/api/connectors/[provider]/authorize/route.ts`):

```ts
JSON.stringify({ binding: material.cookieBinding, verifier: material.codeVerifier })
```

SQL comment on `app_private.connector_oauth_states.pkce_verifier_reference` explicitly says the column holds the **cookie binding hash** and the verifier remains in the cookie (`20260905093303_connector_oauth_runtime.sql`). Column naming is historical; it is **not** a Vault secret id.

Elevate reference path: `vaultCreateVerifier` → `verifier_secret_id` on `oauth_transactions` → cookie = binding only.

### Safe migration steps (later PR — not this one)

1. Add Vault create/read/delete helpers for short-lived PKCE verifiers (host RPCs or reuse Elevate pattern; CS already uses `vault.create_secret` for credentials).
2. Extend `begin_connector_oauth_state` (or sibling) to accept/store a real `pkce_verifier_secret_id` **without** overloading `pkce_verifier_reference` meaning mid-flight — prefer a new column + dual-read period.
3. Authorize: write verifier to Vault; cookie = `{ binding }` only (or binding string like Elevate).
4. Callback: read verifier from Vault via consumed state; exchange; delete verifier; clear cookie.
5. Flip consistency tests from “documents cookie verifier” → “forbids cookie verifier”.
6. Production smoke on one non-critical provider before broad rollout.

**This PR does not change authorize/callback runtime behavior.**

## Remnant workspace package

`packages/franchise-mcp-store-ui/` is an empty stub (nested `node_modules` only). Safe to delete in a follow-up once confirmed unused by workspaces.

## Test stubs added

`tests/consistency/src/connector-oauth-authorization-contract.test.ts`:

- Documents current cookie-verifier divergence (passes).
- `it.todo` for target: authorize must not embed verifier in Set-Cookie payload.
