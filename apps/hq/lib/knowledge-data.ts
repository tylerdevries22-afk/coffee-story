import 'server-only';

import { currentSession, hasRole, isConfigured } from './auth';
import { activeModuleKeys } from './capabilities';
import { demoKnowledgeForBrand } from './knowledge-demo';
import { mapKnowledgeDocument, type KnowledgeWorkspace } from './knowledge-model';
import { serverClient } from './supabase-server';
import { readWorkspaceScope } from './workspace-scope';

type KnowledgeRow = {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly external_ref: string | null;
  readonly metadata: unknown;
  readonly updated_at: string;
};

type KnowledgeAcknowledgementRow = {
  readonly resource_id: string;
  readonly resource_version: string;
  readonly user_id: string;
};

const unavailableWorkspace = (
  tenantName: string,
  source: KnowledgeWorkspace['source'],
  enabled = false,
): KnowledgeWorkspace => ({
  enabled,
  canManage: false,
  tenantName,
  source,
  locationId: null,
  locations: [],
  documents: [],
});

export async function loadKnowledgeWorkspace(): Promise<KnowledgeWorkspace> {
  const session = await currentSession();
  const source = isConfigured() ? 'live' : 'demo';
  if (!session) return unavailableWorkspace('HQ', source);

  const scope = await readWorkspaceScope(session);
  const brandId = scope.organizationId;
  if (!brandId) return unavailableWorkspace(scope.brandName, source);
  const enabled = (await activeModuleKeys(brandId)).has('workforce-training');
  const canManage = hasRole(session, 'brand_owner');
  if (!enabled) {
    return { ...unavailableWorkspace(scope.brandName, source, enabled), canManage };
  }

  const locations = scope.locations.map(({ id, name }) => ({ id, name }));
  if (!isConfigured()) {
    const demo = demoKnowledgeForBrand(brandId);
    return {
      enabled,
      canManage,
      tenantName: scope.brandName,
      source,
      locationId: scope.locationId,
      locations: demo?.locations ?? locations,
      documents: demo?.documents ?? [],
    };
  }

  const client = await serverClient();
  if (!client) return unavailableWorkspace(scope.brandName, source, enabled);
  const result = await client
    .from('catalog_resources')
    .select('id, title, summary, external_ref, metadata, updated_at')
    .eq('brand_id', brandId)
    .is('archived_at', null)
    .in('kind', ['knowledge', 'procedure', 'specification'])
    .order('updated_at', { ascending: false })
    .returns<KnowledgeRow[]>();
  if (result.error) return unavailableWorkspace(scope.brandName, source, enabled);
  const resourceIds = (result.data ?? []).map((row) => row.id);
  const acknowledgementResult = resourceIds.length
    ? await client.from('knowledge_acknowledgements')
      .select('resource_id, resource_version, user_id')
      .eq('brand_id', brandId)
      .in('resource_id', resourceIds)
      .returns<KnowledgeAcknowledgementRow[]>()
    : { data: [] as KnowledgeAcknowledgementRow[], error: null };
  const acknowledgements = acknowledgementResult.error ? [] : acknowledgementResult.data ?? [];
  return {
    enabled,
    canManage,
    tenantName: scope.brandName,
    source,
    locationId: scope.locationId,
    locations,
    documents: (result.data ?? []).flatMap((row) => {
      const document = mapKnowledgeDocument(row, locations);
      if (!document) return [];
      const matching = acknowledgements.filter((item) => (
        item.resource_id === row.id && item.resource_version === document.version
      ));
      return [{
        ...document,
        acknowledgementCount: matching.length,
        acknowledgedByCurrentUser: matching.some((item) => item.user_id === session.userId),
      }];
    }),
  };
}
