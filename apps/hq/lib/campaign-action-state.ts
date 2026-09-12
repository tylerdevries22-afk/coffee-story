export type CampaignActionState = { readonly kind: 'idle' | 'success' | 'error'; readonly message: string };

export const CAMPAIGN_ACTION_IDLE: CampaignActionState = { kind: 'idle', message: '' };
