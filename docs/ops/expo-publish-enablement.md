# Expo publish enablement — tracking

One-time enablement of CI publishing to the Expo Go preview channel.
This PR exists as the completion hook: the browser agent performing the
steps posts its result as a comment here, which notifies the Claude session
that set this up (https://claude.ai/code/session_01CRF6RKFaXGECwR7iuWcbYM).

- [ ] Expo access token created (expo.dev/settings/access-tokens, account tylerdevries222)
- [ ] Repository secret `EXPO_TOKEN` added (Settings → Secrets and variables → Actions)
- [ ] `verify` workflow dispatched on `main` with the publish input checked
- [ ] `publish-preview` job green; QR + exp:// links captured from the run summary

Close this PR once the publish is confirmed; `docs/BUILD-REPORT.md` and
`docs/RUNBOOK.md` carry the durable documentation.
