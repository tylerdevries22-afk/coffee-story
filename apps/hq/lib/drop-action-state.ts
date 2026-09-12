export type DropActionState = { readonly kind: 'idle' | 'success' | 'error'; readonly message: string };

export const DROP_ACTION_IDLE: DropActionState = { kind: 'idle', message: '' };
