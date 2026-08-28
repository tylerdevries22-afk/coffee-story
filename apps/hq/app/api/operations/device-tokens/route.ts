import {
  CORS_HEADERS,
  corsPreflight,
  idempotencyKeyOf,
  jsonError,
  jsonWithCors,
  parseJsonBody,
} from '../../../../lib/api-auth';
import {
  operationDatabaseError,
  operationsRequestContext,
  validOperationDevice,
} from '../../../../lib/operations-api';

type DeviceBody = { token?: unknown; platform?: unknown };

export function OPTIONS(): Response { return corsPreflight(); }

export async function POST(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<DeviceBody>(request);
  if (body instanceof Response) return body;
  const device = validOperationDevice(body);
  if (!actionId || !device?.platform) {
    return jsonError(400, 'invalid_request', 'A valid push token, platform, and Idempotency-Key are required.');
  }
  const result = await context.db.rpc('register_operation_device', {
    target_action_id: actionId,
    target_expo_push_token: device.token,
    target_platform: device.platform,
  });
  if (result.error) return operationDatabaseError(result.error);
  return jsonWithCors({ registered: true }, 201);
}

export async function DELETE(request: Request): Promise<Response> {
  const context = await operationsRequestContext(request);
  if (context instanceof Response) return context;
  const actionId = idempotencyKeyOf(request);
  const body = await parseJsonBody<DeviceBody>(request);
  if (body instanceof Response) return body;
  const device = validOperationDevice(body);
  if (!actionId || !device) {
    return jsonError(400, 'invalid_request', 'A valid push token and Idempotency-Key are required.');
  }
  const current = await context.db.from('operation_staff_devices').select('id')
    .eq('brand_id', context.auth.claims.brand_id).eq('expo_push_token', device.token)
    .eq('is_active', true).maybeSingle<{ id: string }>();
  if (current.error) return operationDatabaseError(current.error);
  if (!current.data) return new Response(null, { status: 204, headers: CORS_HEADERS });
  const result = await context.db.rpc('unregister_operation_device', {
    target_action_id: actionId,
    target_device_id: current.data.id,
  });
  if (result.error) return operationDatabaseError(result.error);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
