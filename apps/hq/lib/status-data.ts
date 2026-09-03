import { headers } from 'next/headers';

import {
  REQUIRED_DATABASE_RELEASE,
  databaseReadable,
  type HealthCredentials,
} from './deep-health';
import {
  dependencyReports,
  overallState,
  statusIncidents,
  type DependencyKey,
  type DependencyReport,
  type DependencyState,
  type ProbeOutcome,
  type StatusIncident,
} from './status-report';
import { isConfigured, serverClient } from './supabase-server';
import { TENANT_ORGS } from './tenants';

const PROBE_TIMEOUT_MS = 4_000;

export type TenantStatus = Readonly<{
  /** The tenant's display name, or null when no tenant answers to this slug. */
  tenantName: string | null;
  slug: string;
  reports: readonly DependencyReport[];
  overall: DependencyState;
  incidents: readonly StatusIncident[];
  observedAt: string;
  /** The migration this build requires, so a reader can quote it in a ticket. */
  schemaRelease: string;
  /** False on a preview deployment with no hosted database to probe. */
  probed: boolean;
}>;

/**
 * The publishable key, never the service role.
 *
 * A status page is served to anyone with the URL, so every read it makes must
 * be one RLS already permits. `platform_release_readiness` is revoked from
 * `anon`, which is why the release below is reported as the build's own
 * requirement rather than probed from here -- the deep probe stays in
 * /api/health, behind its token, where the service role belongs.
 */
function publishableCredentials(): HealthCredentials | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

async function requestOrigin(): Promise<string | null> {
  if (process.env.HQ_ORIGIN) return process.env.HQ_ORIGIN;
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!host) return null;
  const protocol = requestHeaders.get('x-forwarded-proto')
    ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

/** Liveness only: the public half of /api/health, which needs no token. */
async function probePlatformApi(origin: string | null): Promise<ProbeOutcome> {
  if (!origin) return 'unavailable';
  const url = new URL('/api/health', origin).toString();
  for (let index = 0; index < 2; index += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return 'failed';
      const body = await response.json() as { ok?: unknown };
      return body.ok === true ? 'answered' : 'impaired';
    } catch {
      // Retry once; a cold serverless instance can lose the first request.
    } finally {
      clearTimeout(timer);
    }
  }
  return 'failed';
}

type ResolvedTenant = Readonly<{ name: string; ordering: ProbeOutcome }>;

/**
 * Resolves the tenant through the narrowed storefront lookup, which returns at
 * most the one brand named. Only the display name is kept: the row also
 * carries brand_config, and a public page has no business rendering it.
 */
async function resolveTenant(slug: string): Promise<ResolvedTenant | null> {
  const client = await serverClient();
  if (!client) {
    const org = TENANT_ORGS.find((candidate) => candidate.slug === slug);
    return org ? { name: org.name, ordering: 'unavailable' } : null;
  }
  const { data, error } = await client
    .rpc('brand_storefront_lookup', { p_slug: slug })
    .maybeSingle<{ name: unknown }>();
  if (error) return { name: slug, ordering: 'failed' };
  if (!data || typeof data.name !== 'string') return null;
  return { name: data.name, ordering: 'answered' };
}

/**
 * The board projection the tracker and pickup screens read. Reachability only:
 * the response body is never opened, so what RLS shows this reader -- which for
 * an anonymous one is nothing at all -- cannot leak through the status page.
 */
async function probeOrderUpdates(credentials: HealthCredentials | null): Promise<ProbeOutcome> {
  if (!credentials) return 'unavailable';
  const readable = await databaseReadable(
    credentials,
    'board_tickets?select=order_number&limit=1',
    fetch,
    PROBE_TIMEOUT_MS,
  );
  return readable ? 'answered' : 'failed';
}

/** Probes every dependency for one tenant. Returns a null name when the slug is unknown. */
export async function loadTenantStatus(slug: string): Promise<TenantStatus> {
  const observedAt = new Date().toISOString();
  const credentials = isConfigured() ? publishableCredentials() : null;
  const [tenant, origin] = await Promise.all([resolveTenant(slug), requestOrigin()]);
  if (!tenant) {
    return Object.freeze({
      tenantName: null,
      slug,
      reports: [],
      overall: 'unknown' as DependencyState,
      incidents: [],
      observedAt,
      schemaRelease: REQUIRED_DATABASE_RELEASE,
      probed: false,
    });
  }
  const [orderUpdates, platformApi] = await Promise.all([
    probeOrderUpdates(credentials),
    probePlatformApi(origin),
  ]);
  const outcomes: Partial<Record<DependencyKey, ProbeOutcome>> = {
    ordering: tenant.ordering,
    'order-updates': orderUpdates,
    'platform-api': platformApi,
  };
  const reports = dependencyReports(outcomes);
  return Object.freeze({
    tenantName: tenant.name,
    slug,
    reports,
    overall: overallState(reports),
    incidents: statusIncidents(reports, observedAt),
    observedAt,
    schemaRelease: REQUIRED_DATABASE_RELEASE,
    probed: reports.some((report) => report.state !== 'unknown'),
  });
}
