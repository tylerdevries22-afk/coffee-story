/**
 * Structured server-side logging for apps/hq.
 *
 * Every catch block in this app used to fall back to a raw console.error or
 * console.warn with ad hoc message text -- no severity taxonomy, no request
 * or tenant correlation, and no shape a log search could filter on. A
 * webhook or payment failure in production left a plain-text Vercel function
 * log line with nothing tying it to the request or brand that hit it, which
 * is exactly the wrong time for cross-tenant incident triage to be slow.
 *
 * This gives every call site one shape: a single JSON line per call, always
 * carrying level/event/ts plus whatever correlation ids the caller has.
 * `requestContext` derives those ids once per request so routes thread them
 * through instead of re-deriving them in every catch block.
 *
 * Complements Sentry (../instrumentation.ts): Sentry captures exceptions for
 * alerting, stack traces and grouping. This is the plain-text structured
 * line every function invocation's log carries regardless of whether Sentry
 * is configured or whether the failure even reached a thrown exception.
 */
import { randomUUID } from 'node:crypto';

type Level = 'error' | 'warn' | 'info';

export type LogContext = Record<string, unknown>;

/** Matches a context KEY naming a credential, never a value -- so a `reason`
 *  field is never dropped just because its text happens to mention one. */
const SENSITIVE_KEY = /secret|token|key|password|authorization|dsn/iu;

function redact(context: LogContext): LogContext {
  const safe: LogContext = {};
  for (const [field, value] of Object.entries(context)) {
    safe[field] = SENSITIVE_KEY.test(field) ? '[redacted]' : value;
  }
  return safe;
}

type ErrorShape = { name: string; message: string; stack?: string };

/** Name and message only -- never the raw error object -- and a stack only
 *  where it cannot leak into a production log unless already error-level. */
function errorShape(error: unknown, level: Level): ErrorShape {
  const includeStack = level === 'error' || process.env.NODE_ENV !== 'production';
  if (error instanceof Error) {
    const shape: ErrorShape = { name: error.name, message: error.message };
    if (includeStack && error.stack) shape.stack = error.stack;
    return shape;
  }
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return { name: 'UnknownError', message: (error as { message: string }).message };
  }
  return { name: 'UnknownError', message: typeof error === 'string' ? error : 'A non-Error value was thrown.' };
}

function emit(level: Level, event: string, context: LogContext, error: unknown): void {
  const line: LogContext = { level, event, ts: new Date().toISOString(), ...redact(context) };
  if (error !== undefined) line.error = errorShape(error, level);
  const json = JSON.stringify(line);
  if (level === 'error') console.error(json);
  else if (level === 'warn') console.warn(json);
  else console.info(json);
}

export const log = {
  /** `event` names a `domain.action_failed`-shaped fact, never prose. */
  error: (event: string, context: LogContext = {}, error?: unknown): void => emit('error', event, context, error),
  warn: (event: string, context: LogContext = {}, error?: unknown): void => emit('warn', event, context, error),
  info: (event: string, context: LogContext = {}, error?: unknown): void => emit('info', event, context, error),
};

/** The tenancy claims a request carries -- only the field this module reads. */
export type RequestClaims = { readonly brand_id?: string | null } | null | undefined;

/**
 * Correlation ids for one request, derived once and threaded through every
 * `log.*` call in that route handler.
 *
 * `x-vercel-id` is the platform's own per-request id, present on every
 * invocation once deployed; `x-request-id` wins when a caller (or a proxy in
 * front of this deployment) already set one. A fresh id is generated only
 * when neither header reached this function, such as a local dev request.
 */
export function requestContext(request: Request, claims?: RequestClaims): LogContext {
  const requestId = request.headers.get('x-request-id')
    ?? request.headers.get('x-vercel-id')
    ?? `req_${randomUUID()}`;
  const brandId = claims?.brand_id;
  return brandId ? { requestId, brandId } : { requestId };
}
