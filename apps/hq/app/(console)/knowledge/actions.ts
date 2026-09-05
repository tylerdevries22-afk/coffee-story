'use server';

import { revalidatePath } from 'next/cache';

import { currentSession, hasRole, isConfigured } from '@/lib/auth';
import { activeModuleKeys } from '@/lib/capabilities';
import type { KnowledgeActionState } from '@/lib/knowledge-action-state';
import { demoKnowledgeDocument, demoKnowledgeMetadata } from '@/lib/knowledge-demo';
import {
  KNOWLEDGE_INTENTS,
  KNOWLEDGE_MANAGEMENT_INTENTS,
  transitionKnowledgeMetadata,
  type KnowledgeIntent,
  type KnowledgeManagementIntent,
} from '@/lib/knowledge-model';
import { serverClient } from '@/lib/supabase-server';
import { selectedOrganizationId } from '@/lib/workspace-scope';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const value = (formData: FormData, key: string): string => {
  const entry = formData.get(key);
  return typeof entry === 'string' ? entry : '';
};

const messageFor = (intent: KnowledgeIntent): string => ({
  submit_review: 'Document submitted for review.',
  approve: 'Document approved and ready for acknowledgement.',
  retire: 'Document version retired.',
  acknowledge: 'Acknowledgement recorded.',
})[intent];

export async function transitionKnowledgeDocumentAction(
  _previous: KnowledgeActionState,
  formData: FormData,
): Promise<KnowledgeActionState> {
  const resourceId = value(formData, 'resourceId');
  const rawIntent = value(formData, 'intent');
  if (!KNOWLEDGE_INTENTS.includes(rawIntent as KnowledgeIntent)) {
    return { kind: 'error', message: 'Choose a valid document action.' };
  }
  const intent = rawIntent as KnowledgeIntent;
  const session = await currentSession();
  if (!session) return { kind: 'error', message: 'Sign in to continue.' };
  const managementIntent = KNOWLEDGE_MANAGEMENT_INTENTS.includes(
    intent as KnowledgeManagementIntent,
  );
  if (managementIntent && !hasRole(session, 'brand_owner')) {
    return { kind: 'error', message: 'Brand owner access is required for document management.' };
  }
  const brandId = await selectedOrganizationId(session);
  if (!(await activeModuleKeys(brandId)).has('workforce-training')) {
    return { kind: 'error', message: 'Knowledge management is not enabled for this organization.' };
  }
  const actorId = session.userId ?? 'demo-user';
  const now = new Date().toISOString();

  if (!isConfigured()) {
    const document = demoKnowledgeDocument(brandId, resourceId);
    if (!document) return { kind: 'error', message: 'The document could not be found.' };
    if (intent === 'acknowledge') {
      if (document.status !== 'approved') {
        return { kind: 'error', message: 'Only approved documents can be acknowledged.' };
      }
      return {
        kind: 'success', message: messageFor(intent), resourceId,
        status: document.status, acknowledged: true,
      };
    }
    const transitioned = transitionKnowledgeMetadata(
      demoKnowledgeMetadata(document), intent, actorId, now,
    );
    if (!transitioned.ok) return { kind: 'error', message: transitioned.message, resourceId };
    return {
      kind: 'success', message: messageFor(intent), resourceId,
      status: transitioned.status,
    };
  }

  if (!UUID.test(resourceId)) return { kind: 'error', message: 'Choose a valid knowledge document.' };
  const client = await serverClient();
  if (!client) return { kind: 'error', message: 'The knowledge service is unavailable.' };
  if (intent === 'acknowledge') {
    const acknowledged = await client.rpc('acknowledge_knowledge_resource', {
      p_resource_id: resourceId,
    });
    if (acknowledged.error) {
      return { kind: 'error', message: 'This document is not available for acknowledgement.' };
    }
    revalidatePath('/knowledge');
    return {
      kind: 'success', message: messageFor(intent), resourceId,
      status: 'approved', acknowledged: true,
    };
  }
  const expectedUpdatedAt = value(formData, 'expectedUpdatedAt');
  if (!expectedUpdatedAt) return { kind: 'error', message: 'Reload the document before changing it.' };
  const loaded = await client.from('catalog_resources').select('metadata, updated_at')
    .eq('brand_id', brandId).eq('id', resourceId).maybeSingle<{ metadata: unknown; updated_at: string }>();
  if (loaded.error || !loaded.data) return { kind: 'error', message: 'The document could not be loaded.' };
  if (loaded.data.updated_at !== expectedUpdatedAt) {
    return { kind: 'error', message: 'This document changed elsewhere. Reload it before continuing.' };
  }
  const transitioned = transitionKnowledgeMetadata(loaded.data.metadata, intent, actorId, now);
  if (!transitioned.ok) return { kind: 'error', message: transitioned.message, resourceId };
  const saved = await client.from('catalog_resources')
    .update({ metadata: transitioned.metadata, updated_at: now })
    .eq('brand_id', brandId).eq('id', resourceId).eq('updated_at', expectedUpdatedAt)
    .select('id').maybeSingle<{ id: string }>();
  if (saved.error || !saved.data) {
    return { kind: 'error', message: 'The document changed before it could be saved. Reload and try again.' };
  }
  revalidatePath('/knowledge');
  return {
    kind: 'success', message: messageFor(intent), resourceId,
    status: transitioned.status,
  };
}
