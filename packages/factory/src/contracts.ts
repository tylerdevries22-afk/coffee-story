export const FACTORY_SCHEMA_VERSION = 1 as const;

export const FACTORY_STAGES = [
  'intake',
  'demo',
  'credentials',
  'infrastructure',
  'content',
  'canary',
  'live',
] as const;

export type FactoryStage = (typeof FACTORY_STAGES)[number];
export type FactoryProvider =
  | 'platform'
  | 'research'
  | 'github'
  | 'doppler'
  | 'supabase'
  | 'vercel'
  | 'expo'
  | 'apple'
  | 'google-play'
  | 'elevate';
export type FactoryTaskState =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'rolled_back';
export type FactoryRunState =
  | 'draft'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'live'
  | 'rolled_back';

export interface IndustryBlueprint {
  readonly schemaVersion: typeof FACTORY_SCHEMA_VERSION;
  readonly key: string;
  readonly name: string;
  readonly templateVersion: number;
  readonly locale: string;
  readonly supabaseRegion: string;
  readonly vocabulary: Readonly<Record<string, string>>;
}

export interface OnboardingIntake {
  readonly businessName: string;
  readonly tenantSlug: string;
  readonly industryKey: string;
  readonly websiteUrl?: string;
  readonly locationName: string;
  readonly timezone: string;
}

export interface FactoryTaskDefinition {
  readonly key: string;
  readonly label: string;
  readonly stage: FactoryStage;
  readonly provider: FactoryProvider;
  readonly dependsOn: readonly string[];
  readonly credentialKeys: readonly string[];
  readonly timeoutMs: number;
  readonly maximumAttempts: number;
}

export interface ProvisioningPlan {
  readonly schemaVersion: typeof FACTORY_SCHEMA_VERSION;
  readonly industryKey: string;
  readonly tenantSlug: string;
  readonly tasks: readonly FactoryTaskDefinition[];
}

export interface FactoryTaskSnapshot {
  readonly key: string;
  readonly state: FactoryTaskState;
  readonly attemptCount: number;
}

export interface FactoryRunSnapshot {
  readonly id: string;
  readonly businessName: string;
  readonly tenantSlug: string;
  readonly industryKey: string;
  readonly state: FactoryRunState;
  readonly stage: FactoryStage;
  readonly tasks: readonly FactoryTaskSnapshot[];
  readonly createdAt: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };
