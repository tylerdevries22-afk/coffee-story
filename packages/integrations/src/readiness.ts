import type {
  ConnectorCertification,
  ConnectorDescriptor,
  ConnectorEnvironment,
} from './contracts';

export const CONNECTOR_INSTALLATION_STATUSES = [
  'available',
  'setup-required',
  'provider-approval-required',
  'connecting',
  'connected-healthy',
  'connected-degraded',
  'reauthorization-required',
  'disabled',
  'revoked',
  'uncertified',
] as const;

export type ConnectorInstallationStatus =
  (typeof CONNECTOR_INSTALLATION_STATUSES)[number];

export interface ConnectorInstallationState {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly connecting?: boolean;
  readonly disabled?: boolean;
  readonly revoked?: boolean;
  readonly healthy?: boolean;
  readonly authorizationValid?: boolean;
  readonly providerApprovalRequired?: boolean;
}

export type ConnectorReadinessBlocker =
  | 'authorization-valid'
  | 'certification-current'
  | 'configured'
  | 'connected'
  | 'idempotency-supported'
  | 'reconciliation-supported'
  | 'sandbox-supported';

export interface ConnectorReadiness {
  readonly ready: boolean;
  readonly blockers: readonly ConnectorReadinessBlocker[];
  readonly status: ConnectorInstallationStatus;
}

export function isCertificationCurrent(
  certification: ConnectorCertification,
  now: Date,
): boolean {
  if (certification.state !== 'certified' || certification.expiresAt === undefined) {
    return false;
  }
  const expiry = new Date(certification.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now.getTime();
}

export function deriveInstallationStatus(
  certificationCurrent: boolean,
  installation: ConnectorInstallationState,
): ConnectorInstallationStatus {
  if (installation.revoked) return 'revoked';
  if (installation.disabled) return 'disabled';
  if (!certificationCurrent) return 'uncertified';
  if (installation.providerApprovalRequired) return 'provider-approval-required';
  if (!installation.configured) return 'setup-required';
  if (installation.connecting) return 'connecting';
  if (installation.authorizationValid === false) return 'reauthorization-required';
  if (!installation.connected) return 'available';
  return installation.healthy === true ? 'connected-healthy' : 'connected-degraded';
}

export function evaluateConnectorReadiness(
  descriptor: ConnectorDescriptor,
  installation: ConnectorInstallationState,
  environment: ConnectorEnvironment,
  now: Date,
): ConnectorReadiness {
  const certificationCurrent = isCertificationCurrent(descriptor.certification, now);
  const blockers: ConnectorReadinessBlocker[] = [];
  if (!certificationCurrent) blockers.push('certification-current');
  if (!installation.configured) blockers.push('configured');
  if (!installation.connected) blockers.push('connected');
  if (installation.authorizationValid === false) blockers.push('authorization-valid');
  if (descriptor.capabilities.some((capability) => !capability.idempotency)) {
    blockers.push('idempotency-supported');
  }
  if (descriptor.capabilities.some((capability) => !capability.reconciliation)) {
    blockers.push('reconciliation-supported');
  }
  if (
    environment !== 'production' &&
    descriptor.capabilities.some((capability) => !capability.sandbox)
  ) {
    blockers.push('sandbox-supported');
  }
  return {
    blockers,
    ready: blockers.length === 0,
    status: deriveInstallationStatus(certificationCurrent, installation),
  };
}
