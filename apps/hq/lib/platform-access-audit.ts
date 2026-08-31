import { randomUUID } from 'node:crypto';

import {
  recordPlatformAccessEvent,
  type PlatformAccessEnvironment,
  type PlatformAccessEvent,
  type PlatformAccessWriteResult,
} from '@platform/engine';

import { serverEnv } from './api-auth';
import { isConfigured } from './auth';
import type { SessionInfo } from './demo-data';

export type PlatformAccessAuditTarget = {
  action: string;
  brandId: string;
  correlationId?: string;
  locationId: string | null;
  metadata?: Readonly<Record<string, string>>;
  required?: boolean;
};

export type PlatformAccessAuditDependencies = {
  configured: () => boolean;
  correlationId: () => string;
  environment: () => PlatformAccessEnvironment | null;
  logFailure: (details: Record<string, unknown>) => void;
  write: (
    environment: PlatformAccessEnvironment,
    event: PlatformAccessEvent,
  ) => Promise<PlatformAccessWriteResult>;
};

const defaults: PlatformAccessAuditDependencies = {
  configured: isConfigured,
  correlationId: randomUUID,
  environment: serverEnv,
  logFailure: (details) => console.error(JSON.stringify({
    severity: 'error',
    context: 'platform_access_audit',
    ...details,
  })),
  write: recordPlatformAccessEvent,
};

/**
 * Records a configured platform operator crossing into another tenant.
 * Returning false is a hard stop: callers must not change scope when the
 * audit actor or service-role write cannot be established.
 */
export async function recordPlatformAccess(
  session: SessionInfo,
  target: PlatformAccessAuditTarget,
  dependencies: PlatformAccessAuditDependencies = defaults,
): Promise<boolean> {
  if (!dependencies.configured()) return !target.required;
  if (target.brandId === session.brandId && !target.required) return true;
  if (session.role !== 'platform_admin' || !session.userId) {
    dependencies.logFailure({ action: target.action, reason: 'invalid_actor' });
    return false;
  }
  const environment = dependencies.environment();
  if (!environment) {
    dependencies.logFailure({ action: target.action, reason: 'service_unavailable' });
    return false;
  }
  let result: PlatformAccessWriteResult;
  try {
    result = await dependencies.write(environment, {
      action: target.action,
      actorId: session.userId,
      brandId: target.brandId,
      correlationId: target.correlationId ?? dependencies.correlationId(),
      locationId: target.locationId,
      metadata: target.metadata ?? {
        source: target.action.startsWith('workspace.') ? 'workspace_switcher' : 'operate_as_brand',
        surface: 'hq',
      },
    });
  } catch {
    dependencies.logFailure({ action: target.action, reason: 'rpc_unavailable' });
    return false;
  }
  if (result.ok) return true;
  dependencies.logFailure({
    action: target.action,
    errorCode: result.errorCode,
    reason: result.reason,
  });
  return false;
}
