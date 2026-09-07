# Franchise MCP Store UI

One visual source of truth for the searchable connector directory used by the
StillPoint integrations portal and organization onboarding flows. Consumers
own authentication, tenant data, navigation, and provider artwork; this package
owns the accessible layout and interaction model.

```tsx
<McpStore entries={entries} renderIcon={(entry, size) => <Logo id={entry.id} size={size} />} />
```

The package never receives secrets or decides tenant authorization. A host maps
its server-derived connector projection into `McpStoreEntry`, supplies a real
top-level `connectHref` only when that provider is configured, and reports
anything else as `unavailable`. Selection mode is for onboarding intent; it
does not start OAuth before the new organization exists.

## Setup guidance

An entry may carry an optional `setup` block, and the row then renders a
collapsed "How to connect" disclosure badged with the effort involved. The three
kinds describe what the reader has to do, not how the provider is built:

| `kind` | Badge | Use when |
| --- | --- | --- |
| `one-click-oauth` | One-click sign-in | The host holds the OAuth client, so Connect is one press |
| `api-key` | Paste an API key | The provider issues no OAuth client, so a key is copied across |
| `operator-portal` | Guided import | The provider publishes no API and data arrives by upload |

```tsx
<McpStore entries={[{
  id: 'transistor', name: 'Transistor', description: 'Podcast analytics',
  type: 'Marketing', status: 'not_connected',
  connectHref: '/integrations/transistor', connectLabel: 'Add API key',
  setup: {
    kind: 'api-key', estimatedMinutes: 2,
    steps: [{ text: 'Open your account page.', href: 'https://dashboard.transistor.fm/account' }],
    consoleHref: 'https://dashboard.transistor.fm/account',
    documentationHref: 'https://developers.transistor.fm/',
  },
}]} />
```

Steps are the host's copy. Keep each to one imperative line and link it to the
exact screen the reader needs; the component renders them in order and opens
every external link with `rel="noreferrer noopener"`. An entry with no `setup`,
or with an empty `steps` array, renders no disclosure. Selection mode omits
guidance entirely, because onboarding captures intent rather than credentials.

A provider with no API uses `status: 'manual'`, which reads as "Manual import"
rather than "Unavailable" and stays actionable when the host supplies a
`connectHref`. `SetupBadge`, `SetupDisclosure` and `setupKindLabel` are exported
for hosts that need the same badge or step list on a detail page.

`McpStoreEntry.setup` and the `manual` status are additive: an existing host
compiles and behaves unchanged without them.

Both consumers should pin the same release tag and add
`franchise-mcp-store-ui` to Next.js `transpilePackages`. Run `npm run lint`,
`npm run typecheck`, and `npm test` before publishing a tag.

Server routes may import `franchise-mcp-store-ui/oauth` for the shared signed
state, PKCE, nonce, and browser-binding primitives. The subpath is Node-only;
never import it from a client component.
