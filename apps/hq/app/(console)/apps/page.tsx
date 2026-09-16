import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor, withSurfaceUrls, type AppPreview, type OrgPreviewCatalogEntry } from '@/lib/app-previews';
import { activeModuleKeys } from '@/lib/capabilities';
import { loadDeviceWall } from '@/lib/device-wall-data';
import { surfaceUrlsForTenant, tenantPathSurfaceUrls } from '@/lib/org-surface-urls';
import { networkSlugOf, partnerNetworkFor } from '@/lib/partner-surface-urls';
import { currentSession } from '@/lib/auth';
import { readWorkspaceScope } from '@/lib/workspace-scope';
import { tenantOrgById } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

function previewsForSlug(
  slug: string | null,
  locationId: string | null,
  brandConfig?: unknown,
): AppPreview[] {
  // Same origin, per tenant -- not the hosted Vercel stack.
  //
  // This used to force COFFEE_STORY_WALL_HOSTED so an org switch would
  // "retarget real Vercel apps". It cannot: every hosted surface answers
  // frame-ancestors 'self', so the browser refused every frame and the wall
  // painted white for a deployed tenant and Vercel's 404 for an undeployed
  // one. Neither was the app failing.
  //
  // /t/<slug>/<surface> is this origin's copy of that tenant's build, so a
  // switch shows that tenant's own apps rather than relabelling the last one.
  //
  // A venue on a partner network is the exception. Its staff console and its
  // guest app are the partner's own products, already built and already live,
  // so the wall frames those rather than showing this repo's empty copies. The
  // kiosk stays ours: a lobby screen is per-property, drawn from that hotel's
  // published page, and no partner hosts one.
  //
  // Partner framing only paints where the partner's own frame-ancestors admits
  // this origin -- theirs to decide, not ours -- which today means a deployed
  // *.vercel.app HQ and not a localhost one.
  const base = slug
    ? tenantPathSurfaceUrls('', slug, locationId)
    : surfaceUrlsForTenant(slug);
  const partner = partnerNetworkFor(networkSlugOf(brandConfig));
  const urls = partner ? { ...base, ...partner.surfaces } : base;
  return withSurfaceUrls(appPreviewsFor(), urls);
}

export default async function AppsWallPage() {
  const session = await currentSession();
  if (!session) throw new Error('Sign in to view the apps wall.');
  const workspace = await readWorkspaceScope(session);
  const deviceWall = await loadDeviceWall();
  const modules = await activeModuleKeys(deviceWall.brandId);
  const catalog: OrgPreviewCatalogEntry[] = workspace.organizations.map((org) => {
    const registered = tenantOrgById(org.id);
    const slug = org.slug ?? registered?.slug ?? null;
    return {
      id: org.id,
      slug,
      name: org.name,
      previews: previewsForSlug(
        slug, deviceWall.locations[0]?.id ?? null, registered?.brandConfig,
      ),
    };
  });
  const selected = catalog.find((entry) => entry.id === workspace.organizationId) ?? catalog[0];
  const previews = selected?.previews ?? previewsForSlug(null, deviceWall.locations[0]?.id ?? null);
  return (
    <AppsPreviewWall
      catalog={catalog}
      constructionOperator={modules.has('construction-projects')}
      deviceWall={deviceWall}
      organizationId={workspace.organizationId ?? selected?.id ?? null}
      previews={previews}
    />
  );
}
