# ACTZ tenant pack

This folder is the franchisor tenant for ACTZ, an adventure-activity and
lodging network that will own many hotel and venue brands on this platform.

ACTZ declares only the `hq` surface: it ships no customer, kiosk, operator,
or display binary of its own, and it sells nothing directly (every
`features` flag is `false`). Its `tokens` block is the network's brand
default. Member hotel and venue tenants declare `organization.kind:
"franchisee"`, `network.relationship: "member"`, and `inheritance.mode:
"network"` with `sourceTenantSlug: "actz"`; they ship `["hq", "lobby"]` and
inherit these tokens, overriding whatever their own brand needs to.

ACTZ installs no `commerce-catalog`, so this folder carries no `menu.csv`,
`menu-categories.json`, or `modifiers.json` -- per `tenants/_template/README.md`,
a tenant that installs no `commerce-catalog` module may omit that entire
group. `packs.json` stays a core file with an empty object. There is no
`modules.json`: ACTZ installs no capability module at all (no operations,
training, or device-wall), so its desired module state is the empty set,
which onboarding treats identically to an absent file. It also declares no
`locations`, since it staffs no operating site itself -- that belongs to
each member property's own tenant pack.
