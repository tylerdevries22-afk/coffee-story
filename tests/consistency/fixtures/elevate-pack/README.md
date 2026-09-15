# Elevate tenant pack fixture

`elevate-web-demo/` is **copied, not authored here**. It is the exact output of
Elevate Web Dev Solutions' tenant pack writer for a fixed wizard input, and the
same bytes are committed in that repo at `fixtures/tenant-pack/`.

Elevate owns the pack schema; this repo consumes it. That is only a contract if
both sides check it, so:

- **There:** a test asserts the writer still produces these bytes.
- **Here:** `../../src/elevate-pack-passes-both-gates.test.ts` runs them through
  `parseTenantManifest` and `validateTenant` — is it well-formed, and can we
  build from it? Those are different questions, and the split between them is
  the contract.

To refresh, regenerate there and copy the directory across:

```
UPDATE_TENANT_PACK_FIXTURE=1 pnpm --filter @workspace/api-server test
```

Never hand-edit these files. A change that makes this repo's tests pass while
Elevate still emits the old shape is exactly the drift both tests exist to stop.
