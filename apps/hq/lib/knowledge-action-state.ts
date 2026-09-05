import type { KnowledgeStatus } from '@/lib/knowledge-model';

export type KnowledgeActionState = {
  readonly kind: 'idle' | 'success' | 'error';
  readonly message: string;
  readonly resourceId?: string;
  readonly status?: KnowledgeStatus;
  readonly acknowledged?: boolean;
};

export const KNOWLEDGE_ACTION_IDLE: KnowledgeActionState = {
  kind: 'idle',
  message: '',
};
