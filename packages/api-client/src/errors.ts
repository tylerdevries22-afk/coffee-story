/** A platform API response outside the 2xx range, with the server's word for why. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The error body shape every platform API route returns. */
export type ApiErrorBody = {
  error: { code: string; message: string };
};

export async function throwForResponse(response: Response): Promise<never> {
  let code = 'unknown';
  let message = `Request failed with status ${response.status}.`;
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error body: keep the status-derived message.
  }
  throw new ApiError(response.status, code, message);
}
