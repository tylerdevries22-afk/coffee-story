import { ExternalRequestError, fetchExternalWithRetry } from './http';

/** The provider may have accepted the send; retrying could duplicate it. */
export class NotificationDeliveryUncertainError extends Error {
  readonly code = 'delivery_uncertain';
  constructor(cause?: unknown) {
    super('Notification delivery is uncertain; automatic retry was stopped.', { cause });
    this.name = 'NotificationDeliveryUncertainError';
  }
}

/** Providers without send idempotency may retry only explicit rate-limit rejections. */
export async function requestNotification(input: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetchExternalWithRetry(input, init, { retryMode: 'rejected-only' });
    if (response.status >= 500) throw new NotificationDeliveryUncertainError();
    return response;
  } catch (error) {
    if (error instanceof ExternalRequestError
      && ['network', 'timeout', 'response_too_large'].includes(error.code)) {
      throw new NotificationDeliveryUncertainError(error);
    }
    throw error;
  }
}
