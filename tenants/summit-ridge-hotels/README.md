# Summit Ridge Hotels

A hotel chain on the ACTZ network, and the first `franchisee` tenant in this
repo. It exists to prove one thing the platform claims and had never shown: that
a network member with many branches is one tenant folder, not one folder per
building.

## Shape

- `organization.kind: franchisee`, `network.relationship: member` of `actz`
- `inheritance.mode: network`, `sourceTenantSlug: actz` — the network's tokens
  are the default and every override is listed in `inheritance.overrides`
- `surfaces: ["hq", "lobby"]` — the chain's console, and the unattended screen
  in each property's entrance. No guest app: a guest books in the network's
  traveller app, which the network already ships.

## Branches

`locations` is the branch list. Adding the chain's next hotel is one entry here.

Each branch carries a `placeQuery` — the property named the way a person would
name it — rather than a hand-typed `googlePlaceId`. A resolver calls the Places
API, confirms the listing is lodging, and stores the id. An opaque id typed in
by hand that points at the café next door is a silent error: the lobby screen
would show the café's hours under the hotel's name and nothing would notice.

## Assets

None yet. This tenant is not `--apply`-ed into the guest bundles — it ships no
guest app — so the fixed asset list in `scripts/lib/onboard-assets.ts` is not on
its path.
