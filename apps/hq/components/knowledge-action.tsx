'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import {
  transitionKnowledgeDocumentAction,
} from '@/app/(console)/knowledge/actions';
import {
  KNOWLEDGE_ACTION_IDLE,
  type KnowledgeActionState,
} from '@/lib/knowledge-action-state';
import {
  knowledgeActionsFor,
  type KnowledgeAvailableAction,
  type KnowledgeDocument,
} from '@/lib/knowledge-model';

type KnowledgeActionProps = {
  readonly document: KnowledgeDocument;
  readonly canManage: boolean;
  readonly source: 'demo' | 'live';
  readonly onResolved: (state: KnowledgeActionState) => void;
};

export function KnowledgeAction({ document, canManage, source, onResolved }: KnowledgeActionProps) {
  const actions = knowledgeActionsFor(document, canManage);
  if (!actions.length) {
    return (
      <p className="knowledge-action-complete">
        {document.status === 'retired' ? 'This version is retired.' : 'No action is required from you.'}
      </p>
    );
  }
  return actions.map((action) => (
    <KnowledgeActionForm key={action.intent} document={document} action={action}
      source={source} onResolved={onResolved} />
  ));
}

function KnowledgeActionForm({ document, action, source, onResolved }: Omit<KnowledgeActionProps, 'canManage'> & {
  readonly action: KnowledgeAvailableAction;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    transitionKnowledgeDocumentAction,
    KNOWLEDGE_ACTION_IDLE,
  );

  useEffect(() => {
    if (state.kind !== 'success') return;
    onResolved(state);
    if (source === 'live') router.refresh();
  }, [onResolved, router, source, state]);

  return (
    <form action={submit} className="knowledge-action" aria-busy={pending}>
      <input type="hidden" name="resourceId" value={document.id} />
      <input type="hidden" name="expectedUpdatedAt" value={document.updatedAt} />
      <input type="hidden" name="intent" value={action.intent} />
      <button className="button" type="submit" disabled={pending}>
        {pending ? 'Saving…' : action.label}
      </button>
      <p role={state.kind === 'error' ? 'alert' : 'status'} data-kind={state.kind}>
        {state.message}
      </p>
    </form>
  );
}
