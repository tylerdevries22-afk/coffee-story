/** Consent contract that includes application-fee recipient access. */
export const SQUARE_OAUTH_SCOPE_CONTRACT_VERSION = 2;

export type SquareConnectionUiStatus = 'connected' | 'reauthorization-required';

export function squareConnectionStatus(contractVersion: number): SquareConnectionUiStatus {
  return contractVersion >= SQUARE_OAUTH_SCOPE_CONTRACT_VERSION
    ? 'connected'
    : 'reauthorization-required';
}
