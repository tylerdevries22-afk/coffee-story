import type { DeviceConnectionState, DeviceWallPolicy } from './types';

type ConnectionInput = {
  readonly lastSeenAt: string | null;
  readonly archivedAt: string | null;
};

export function connectionStateAt(
  installation: ConnectionInput,
  policy: Pick<DeviceWallPolicy, 'connection'>,
  nowMs = Date.now(),
): DeviceConnectionState {
  if (installation.archivedAt) return 'archived';
  if (!installation.lastSeenAt) return 'provisioning';
  const lastSeenMs = Date.parse(installation.lastSeenAt);
  if (!Number.isFinite(lastSeenMs) || lastSeenMs > nowMs + 60_000) return 'degraded';
  const ageSeconds = (nowMs - lastSeenMs) / 1_000;
  if (ageSeconds <= policy.connection.degradedAfterSeconds) return 'online';
  if (ageSeconds <= policy.connection.offlineAfterSeconds) return 'degraded';
  return 'offline';
}

export function shouldArchiveInstallation(
  lastSeenAt: string | null,
  createdAt: string,
  archiveAfterDays: number,
  nowMs = Date.now(),
): boolean {
  const reference = Date.parse(lastSeenAt ?? createdAt);
  return Number.isFinite(reference) && nowMs - reference >= archiveAfterDays * 86_400_000;
}
