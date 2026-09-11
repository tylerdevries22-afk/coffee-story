import { AppsPreviewWall } from '@/components/apps-preview';
import { appPreviewsFor, withSurfaceUrls, type AppPreview, type OrgPreviewCatalogEntry } from '@/lib/app-previews';
import { activeModuleKeys } from '@/lib/capabilities';
import { loadDeviceWall } from '@/lib/device-wall-data';
import { surfaceUrlsForTenant } from '@/lib/org-surface-urls';
import { currentSession } from '@/lib/auth';
import { readWorkspaceScope } from '@/lib/workspace-scope';
import { tenantOrgById } from '@/lib/tenants';

export const dynamic = 'force-dynamic';

function previewsForSlug(slug: string | null): AppPreview[] {
  // Staff wall prefers known hosted stacks so org switches retarget real Vercel apps.
  const urls = surfaceUrlsForTenant(slug, {
    ...process.env,
    COFFEE_STORY_WALL_HOSTED: slug ? '1' : process.env.COFFEE_STORY_WALL_HOSTED,
  });
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
      previews: previewsForSlug(slug),
    };
  });
  const selected = catalog.find((entry) => entry.id === workspace.organizationId) ?? catalog[0];
  const previews = selected?.previews ?? previewsForSlug(null);
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
