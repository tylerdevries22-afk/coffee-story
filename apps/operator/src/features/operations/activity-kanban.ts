import type { OperatorTaskOccurrence } from './model';

export type ActivityLaneKey = 'todo' | 'active' | 'done';
export type ActivityLane = {
  key: ActivityLaneKey;
  label: string;
  tasks: readonly OperatorTaskOccurrence[];
};

const LANE_LABELS: Readonly<Record<ActivityLaneKey, string>> = {
  todo: 'To do', active: 'In progress', done: 'Complete',
};

export function activityLaneKey(task: OperatorTaskOccurrence): ActivityLaneKey | null {
  if (task.status === 'scheduled') return 'todo';
  if (task.status === 'claimed') return 'active';
  if (task.status === 'completed') return 'done';
  return null;
}

export function activityAudience(task: OperatorTaskOccurrence): string {
  const label = task.snapshot.requiredRoleLabels[0];
  if (label) return label;
  const role = task.snapshot.requiredRoleIds[0] ?? '';
  return ({
    'general-contractor': 'General Contractor',
    'trade-contractor': 'Contractor',
    'project-admin': 'Admin',
  } as Readonly<Record<string, string>>)[role] ?? 'Field team';
}

export function activityLanes(tasks: readonly OperatorTaskOccurrence[]): ActivityLane[] {
  const keys: readonly ActivityLaneKey[] = ['todo', 'active', 'done'];
  return keys.map((key) => ({
    key,
    label: LANE_LABELS[key],
    tasks: tasks.filter((task) => activityLaneKey(task) === key)
      .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)),
  }));
}
