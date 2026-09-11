import { TenantPackageError } from '@platform/factory';

function leaseError(error: unknown): TenantPackageError {
  return error instanceof TenantPackageError
    ? error
    : new TenantPackageError('cleanup_renewal_failed', 'Cleanup claim renewal failed.');
}

function validateRenewal(value: unknown): void {
  if (typeof value !== 'string') {
    throw new TenantPackageError('cleanup_renewal_invalid', 'Cleanup claim renewal is invalid.');
  }
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TenantPackageError('cleanup_renewal_invalid', 'Cleanup claim renewal is invalid.');
  }
}

export async function runWithClaimHeartbeat(input: {
  renew: () => Promise<unknown>;
  remove: (signal: AbortSignal) => Promise<void>;
  heartbeatMs: number;
}): Promise<void> {
  try {
    validateRenewal(await input.renew());
  } catch (error) {
    throw leaseError(error);
  }
  const controller = new AbortController();
  let heartbeatFailure: TenantPackageError | undefined;
  let heartbeatRequest: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeatRequest) return;
    heartbeatRequest = input.renew()
      .then(validateRenewal)
      .catch((error: unknown) => {
        heartbeatFailure = leaseError(error);
        controller.abort();
      })
      .finally(() => { heartbeatRequest = undefined; });
  }, input.heartbeatMs);
  let removalFailure: unknown;
  try {
    await input.remove(controller.signal);
  } catch (error) {
    removalFailure = error;
  } finally {
    clearInterval(timer);
    const pending = heartbeatRequest;
    if (pending) await pending;
  }
  if (heartbeatFailure) throw heartbeatFailure;
  if (removalFailure) throw removalFailure;
}
