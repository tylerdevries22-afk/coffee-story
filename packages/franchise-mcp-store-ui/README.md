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

Both consumers should pin the same release tag and add
`franchise-mcp-store-ui` to Next.js `transpilePackages`. Run `npm run lint`,
`npm run typecheck`, and `npm test` before publishing a tag.

Server routes may import `franchise-mcp-store-ui/oauth` for the shared signed
state, PKCE, nonce, and browser-binding primitives. The subpath is Node-only;
never import it from a client component.
