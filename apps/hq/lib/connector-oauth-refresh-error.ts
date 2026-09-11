import type { ConnectorToken } from './connector-oauth-exchange';

export class ConnectorRefreshError extends Error {
  readonly #issuedCredential: ConnectorToken | null;
  constructor(
    readonly stage: 'unsupported' | 'unconfigured' | 'transport' | 'provider' | 'payload',
    readonly status: number | null,
    readonly code: 'configuration_unavailable' | 'credential_contract_invalid'
      | 'invalid_grant' | 'provider_rejected'
      | 'rotation_ambiguous' | 'transport' | 'payload',
    readonly retryable: boolean,
    issuedCredential: ConnectorToken | null = null,
  ) {
    super(`Connector token refresh failed at ${stage}.`);
    this.name = 'ConnectorRefreshError';
    this.#issuedCredential = issuedCredential;
  }

  get issuedCredential(): ConnectorToken | null { return this.#issuedCredential; }
}
