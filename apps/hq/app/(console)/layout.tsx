import type { CSSProperties, ReactNode } from 'react';
import { headers } from 'next/headers';
import { after } from 'next/server';

import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase-server';
import { Icon } from '@/components/icon';
import { ConsoleShell } from '@/components/console-shell';
import { consoleSectionsFor } from '@/lib/console-navigation';
import { serverClient } from '@/lib/supabase-server';
import { hqTheme } from '@/lib/theme';
import { recordHqScreen } from '@/lib/hq-telemetry';
import { readWorkspaceScope, orgSlug } from '@/lib/workspace-scope';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { selectOrganization, selectLocation } from '@/app/actions/workspace';

import { signOut } from './login/actions';

/**
 * The console shell: one role-aware rail, page context, and session controls.
 *
 * A route group rather than the root layout, because not everything this app
 * serves is the console. The pickup display is a storefront screen that
 * happens to be served from here and must not inherit a nav a guest can see.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [session, client] = await Promise.all([currentSession(), serverClient()]);
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-hq-pathname') ?? '';
  const isPublicConsolePath = pathname === '/login' || pathname.startsWith('/status/');
  if (isConfigured() && !session && !isPublicConsolePath) {
    const user = client ? await client.auth.getUser() : null;
    return (
      <div className="shell">
        <main className="main">
          <section className="card access-card">
            <h1>Tenant access required</h1>
            <p className="subtitle">
              {user?.data.user?.email
                ? `You are signed in as ${user.data.user.email}, but this account is not assigned to a tenant. Ask a brand owner to add your staff role, then sign in again.`
                : 'Your session is not assigned to a tenant. Sign in again or ask a brand owner to add your staff role.'}
            </p>
            <form action={signOut}>
              <button type="submit" className="button">Sign out</button>
            </form>
          </section>
        </main>
      </div>
    );
  }
  // The tenant-safe wall preview is embedded by the /wall console page. It
  // lives in this route group so it can reuse the session-bound data layer,
  // but must not inherit the sidebar or console chrome inside the iframe.
  if (pathname.startsWith('/wall/preview/')) return children;
  const brand = client && session
    ? await client.from('brands').select('brand_config, operations').eq('id', session.brandId)
      .maybeSingle<{ brand_config: unknown; operations: boolean }>()
    : null;
  const brandConfig = brand && !brand.error ? brand.data?.brand_config : null;
  if (client && session && pathname && !pathname.startsWith('/wall/preview/')) {
    const [sessionData, authenticatedUser] = await Promise.all([
      client.auth.getSession(),
      client.auth.getUser(),
    ]);
    const accessToken = sessionData.data.session?.access_token;
    const userConsent = authenticatedUser.data.user?.user_metadata?.analytics_consent === true;
    const privacy = brandConfig && typeof brandConfig === 'object' && !Array.isArray(brandConfig)
      ? (brandConfig as { privacy?: unknown }).privacy
      : null;
    const tenantPolicy = Boolean(privacy && typeof privacy === 'object' && !Array.isArray(privacy)
      && (privacy as { analyticsBehavioral?: unknown }).analyticsBehavioral === true);
    const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
    const protocol = requestHeaders.get('x-forwarded-proto') ?? (forwardedHost?.startsWith('localhost') ? 'http' : 'https');
    const endpointOrigin = process.env.HQ_ORIGIN ?? (forwardedHost ? `${protocol}://${forwardedHost}` : null);
    if (accessToken && endpointOrigin) {
      after(async () => {
        await recordHqScreen({
          accessToken,
          behavioralConsent: tenantPolicy && userConsent,
          brandId: session.brandId,
          endpointOrigin,
          pathname,
        });
      });
    }
  }
  // Signed out there is no tenant to name, so the rail wears the console's own
  // identity rather than the first tenant onboarded to it. Reachable only on
  // /login and /status/*: every other path with no session returned above.
  // Scope drives the shell's identity so the console themes and titles itself
  // for whichever organization is selected, not only the session's home brand.
  const scope = session ? await readWorkspaceScope(session) : null;
  const themeConfig = scope?.brandConfig ?? brandConfig;
  const brandName = scope?.brandName ?? session?.brandName ?? 'HQ';
  const words = brandName.split(/\s+/).filter(Boolean);
  // A one-word brand takes two letters from that word -- "Bloom" reads as BL,
  // where one initial reads as a stray letter next to a two-initial neighbour.
  const initials = (words.length === 1
    ? (words[0] ?? '').slice(0, 2)
    : words.slice(0, 2).map((word) => word.charAt(0)).join('')
  ).toUpperCase() || 'HQ';
  const statusSlug = orgSlug(brandName);
  const menuHref = hasRole(session, 'brand_owner') ? '/catalog' : '/menu';
  const canManageTraining = hasRole(session, 'location_manager');
  const canManagePlatform = hasRole(session, 'platform_admin');
  const canManageBrand = hasRole(session, 'brand_owner');
  const canViewManagement = hasRole(session, 'location_manager');
  const operationsEnabled = client ? brand?.data?.operations === true : true;
  const consoleSections = consoleSectionsFor({
    menuHref,
    canManageTraining,
    canManagePlatform,
    canManageBrand,
    canViewAnalytics: canViewManagement,
    canViewIntegrations: canViewManagement,
    canManageOperations: canViewManagement && operationsEnabled,
  });
  return (
    <ConsoleShell
      theme={hqTheme(themeConfig) as CSSProperties}
      sections={consoleSections}
      brandName={brandName}
      initials={initials}
      statusHref={`/status/${statusSlug}`}
      dataMode={isConfigured() ? 'hosted' : 'preview'}
      switcher={session && scope ? (
        <WorkspaceSwitcher
          organizations={scope.organizations}
          locations={scope.locations}
          organizationId={scope.organizationId}
          locationId={scope.locationId}
          selectOrganizationAction={selectOrganization}
          selectLocationAction={selectLocation}
        />
      ) : undefined}
      sessionFooter={(
        <div className="session">
          {session ? (
            <div className="session-row">
              <span className="session-avatar">{initials}</span>
              <span className="session-copy"><strong>{session.email}</strong><small>{session.role.replace('_', ' ')}</small></span>
              {isConfigured() ? (
                <form action={signOut}>
                  <button type="submit" className="session-signout" aria-label="Sign out" title="Sign out"><Icon name="external" size={15} /></button>
                </form>
              ) : null}
            </div>
          ) : <span>Signed out</span>}
        </div>
      )}
    >
      {children}
    </ConsoleShell>
  );
}
