import type { OperationOccurrenceStatus } from './types';

/** Public-wall-safe project activity. The view intentionally exposes no actor ids or notes. */
export type ActivityBoardItemRow = {
  id: string;
  brand_id: string;
  location_id: string;
  title: string;
  audience_labels: string[];
  status: Extract<OperationOccurrenceStatus, 'scheduled' | 'claimed' | 'completed'>;
  scheduled_for: string;
  due_at: string;
  actor_name: string | null;
  updated_at: string;
};
