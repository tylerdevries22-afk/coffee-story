const PAIRING_CODE = /^[23456789BCDFGHJKMNPQRSTVWXZ]{8}$/;
const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPERATOR_SCHEME = 'platform-operator:';

export type OperatorPairingIntent = {
  readonly code: string;
  readonly tenantSlug: string;
};

export class OperatorPairingLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorPairingLinkError';
  }
}

function code(value: unknown): string {
  if (typeof value !== 'string' || !PAIRING_CODE.test(value)) {
    throw new OperatorPairingLinkError('The pairing code is invalid.');
  }
  return value;
}

function tenantSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !TENANT_SLUG.test(value)) {
    throw new OperatorPairingLinkError('The tenant is invalid.');
  }
  return value;
}

/** A QR may carry a pairing secret only over the installed Operator app's scheme. */
export function operatorPairingLink(value: OperatorPairingIntent): string {
  const params = new URLSearchParams({ code: code(value.code), tenant: tenantSlug(value.tenantSlug) });
  return `${OPERATOR_SCHEME}//pair?${params.toString()}`;
}

/** Rejects URLs from the web, another app, malformed links, and mixed-case codes. */
export function parseOperatorPairingLink(value: unknown): OperatorPairingIntent | null {
  if (typeof value !== 'string' || value.length > 240) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== OPERATOR_SCHEME || url.hostname !== 'pair') return null;
    return { code: code(url.searchParams.get('code')), tenantSlug: tenantSlug(url.searchParams.get('tenant')) };
  } catch {
    return null;
  }
}
