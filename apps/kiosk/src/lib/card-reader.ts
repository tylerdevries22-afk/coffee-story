/**
 * THE SEAM.
 *
 * Square's Reader SDK needs a development client, not Expo Go, so card capture
 * cannot be real in this build. Everything on both sides of this call is:
 * the order is created first and paid second, the checkout reducer drives the
 * states, and the idempotency key survives a retry.
 *
 * A real reader replaces this function and nothing else. The shape is chosen so
 * that it can: it can already report a decline, which a resolve-always stub
 * could not, and it takes an AbortSignal because a kiosk with a hung reader and
 * a queue behind it has to be able to say something.
 */
export type AuthorizeResult =
  | { ok: true; reference: string }
  | { ok: false; code: 'declined' | 'reader_unavailable' | 'cancelled'; message: string };

const SIMULATED_READ_MS = 1_200;

export async function authorize(
  input: { amountCents: number; orderId: string },
  signal?: AbortSignal,
): Promise<AuthorizeResult> {
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_READ_MS));
  if (signal?.aborted) return { ok: false, code: 'cancelled', message: 'The payment was cancelled.' };
  return { ok: true, reference: `simulated-${input.orderId}` };
}

/** Whether this build can actually take a card. Screens read it, not a comment. */
export const CARD_READER_IS_SIMULATED = true;
