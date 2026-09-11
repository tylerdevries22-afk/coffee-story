export type ConnectorToken = Readonly<Record<string, unknown>> & {
  readonly access_token: string;
  readonly refresh_token?: string;
};

export class ConnectorExchangeError extends Error {
  readonly #issuedCredential: ConnectorToken | null;
  readonly stage: 'unconfigured' | 'transport' | 'provider' | 'payload';
  readonly status: number | null;

  constructor(
    stage: ConnectorExchangeError['stage'],
    status: number | null,
    detail: string,
    issuedCredential: ConnectorToken | null = null,
  ) {
    super(`Connector token exchange failed at ${stage}: ${detail}`);
    this.name = 'ConnectorExchangeError';
    this.stage = stage;
    this.status = status;
    this.#issuedCredential = issuedCredential;
  }

  get issuedCredential(): ConnectorToken | null { return this.#issuedCredential; }
}
