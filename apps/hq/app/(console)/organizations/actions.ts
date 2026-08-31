'use server';

/**
 * Creating a new organization (a brand) and switching to it.
 *
 * Adding a tenant to the platform is a platform-operator action: `brands_insert`
 * admits only a platform_admin, so this gates on that role and the RLS agrees.
 * The brand is inserted blank -- name + slug + neutral feature flags, an empty
 * brand_config so the theme resolver supplies neutral defaults -- and the
 * console immediately switches to it (org cookie set, location cleared) and
 * sends the operator to add the first location. In the demo it lands in the
 * in-memory org store so the whole flow works with no database.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { addDemoOrg } from '@/lib/demo-orgs';
import { parseOrgDraft } from '@/lib/org-input';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import {
  expiredWorkspaceCookieOptions,
  LOCATION_COOKIE,
  ORG_COOKIE,
  workspaceCookieOptions,
} from '@/lib/workspace-cookie';

export async function createOrganizationAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'platform_admin')) redirect('/locations?created=denied');

  const parsed = parseOrgDraft({ name: String(formData.get('name') ?? '') });
  if (!parsed.ok) redirect(`/organizations/new?error=${encodeURIComponent(parsed.error)}`);
  const draft = parsed.draft;

  const store = await cookies();
  const switchTo = (orgId: string): never => {
    store.set(ORG_COOKIE, orgId, workspaceCookieOptions());
    // A location id only means something inside its owning org.
    store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions());
    revalidatePath('/', 'layout');
    redirect('/locations/new');
  };

  if (!isConfigured()) {
    addDemoOrg({ id: draft.slug, slug: draft.slug, name: draft.name, kind: 'brand', brandConfig: draft.brandConfig });
    switchTo(draft.slug);
  }

  const client = await serverClient();
  if (!client) redirect('/organizations/new?error=' + encodeURIComponent('This deployment is not connected to Supabase.'));
  const insert = await client.rpc('create_platform_organization', {
    p_brand_config: draft.brandConfig,
    p_correlation_id: crypto.randomUUID(),
    p_name: draft.name,
    p_slug: draft.slug,
  });
  if (insert.error || typeof insert.data !== 'string') {
    redirect('/organizations/new?error=' + encodeURIComponent('Could not create the organization — that handle may already be taken.'));
  }
  switchTo(insert.data);
}
