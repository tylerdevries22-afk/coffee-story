import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor, withSurfaceUrls, type AppPreview, type OrgPreviewCatalogEntry } from '@/lib/app-previews';
import { activeModuleKeys } from '@/lib/capabilities';
import { loadDeviceWall } from '@/lib/device-wall-data';
import { surfaceUrlsForTenant, tenantPathSurfaceUrls } from '@/lib/org-surface-urls';
import { currentSession } from '@/lib/auth';
import { readWorkspaceScope } from '@/lib/workspace-scope';
import { tenantOrgById } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

function previewsForSlug(slug: string | null, locationId: string | null): AppPreview[] {
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
  const urls = slug
    ? tenantPathSurfaceUrls('', slug, locationId)
    : surfaceUrlsForTenant(slug);
  return withSurfaceUrls(appPreviewsFor(), urls);
}

export default async function AppsWallPage() {
  const session = await currentSession();
  if (!session) throw new Error('Sign in to view the apps wall.');
  const workspace = await readWorkspaceScope(session);
  const deviceWall = await loadDeviceWall();
  const modules = await activeModuleKeys(deviceWall.brandId);
  const catalog: OrgPreviewCatalogEntry[] = workspace.organizations.map((org) => {
    const slug = org.slug ?? tenantOrgById(org.id)?.slug ?? null;
    return {
      id: org.id,
      slug,
      name: org.name,
      previews: previewsForSlug(slug, deviceWall.locations[0]?.id ?? null),
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
