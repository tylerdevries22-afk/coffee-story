export type OrganizationActionState = { kind: 'idle' | 'error'; message?: string };

export const ORGANIZATION_IDLE: OrganizationActionState = { kind: 'idle' };
