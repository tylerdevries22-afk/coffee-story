# HQ UI audit

## Route inventory

| Area | Routes | Shared owner |
| --- | --- | --- |
| Overview | `/` | dashboard page + KPI rollups |
| Workspace | `/locations`, `/locations/new`, `/organizations/new` | location actions + workspace switchers |
| Catalog | `/menu`, `/menu/import`, `/catalog`, `/content` | menu/content editors |
| Execution | `/operations`, `/operations/templates`, `/operations/schedules`, `/operations/history`, `/operations/reporting`, `/operations/retention` | `OperationsRoute` |
| Analytics | `/analytics`, `/analytics/apps`, `/analytics/commerce`, `/analytics/operations`, `/analytics/training`, `/analytics/growth`, `/analytics/reliability` | `AnalyticsRoute` + `AnalyticsDashboard` |
| Growth | `/drops`, `/campaigns`, `/customers`, `/fees` | server-rendered data pages |
| Integrations | `/integrations`, `/integrations/connected`, `/integrations/activity`, `/integrations/health`, `/integrations/[provider]` | `IntegrationWorkspace` |
| Configuration | `/brand`, `/kiosk`, `/training`, `/onboarding` | typed configuration editors |
| Displays and status | `/wall`, `/wall/preview/[location]`, `/status/[tenant]` | wall preview + public status surfaces |
| Access | `/login` | authenticated console layout |

## System ownership

- `ConsoleShell` owns desktop rail, mobile drawer, page context, focus return,
  skip navigation, and tenant/location switching.
- `hqTheme` is the only HQ token adapter. It receives the selected tenant
  configuration and supplies both legacy console variables and semantic
  shadcn/ReUI roles.
- `ConsoleState` is the shared empty, partial-data, offline, error, and
  permission-denied feedback surface. It uses generated ReUI alert and shadcn
  empty primitives rather than per-route placeholder markup.
- `AnalyticsDashboard`, `OperationsRoute`, integration, content, kiosk, brand,
  and training workspaces are the route-level composition boundaries. They keep
  the existing server actions, role gates, API contracts, and typed data
  loaders intact.

## State coverage

All data routes retain their explicit unavailable-data behavior. Shared
feedback is now used for zero-record and partial windows; server error and
permission routes continue to preserve their existing role-aware messages.
Tables remain horizontally contained and keyboard-focusable where dense data is
unavoidable on small screens. The console uses `min-width: 320px`, responsive
grid breakpoints, a scroll-locked mobile drawer, visible focus rings, and
reduced-motion overrides.

## Registry decision record

- shadcn/ui is initialized in `apps/hq` with Tailwind v4 and the Radix base.
- ReUI's official free registry supplies the alert and empty-state primitives.
  Only open-source `c-*` registry items were added.
- Existing accessible analytics bars remain the analytical visualisation
  baseline: they have a textual table alternative, avoid a chart dependency,
  and consume tenant tokens. Tremor Blocks and Shadcn Space blocks were
  reviewed but not added because their available matching dashboard blocks
  would duplicate existing ownership or require paid access.
