import {
  authenticate,
  corsPreflight,
  jsonError,
  jsonWithCors,
  notConfigured,
  serverEnv,
  serviceDb,
} from '../../../../../lib/api-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  const { runId } = await context.params;
  if (!UUID.test(runId)) return jsonError(400, 'invalid_run_id', 'The training run id is invalid.');
  const result = await db.from('training_bootstrap_runs')
    .select('id, status, stage, progress, error_code, error_detail, started_at, finished_at, created_at')
    .eq('id', runId)
    .eq('brand_id', auth.claims.brand_id)
    .maybeSingle();
  if (result.error) return jsonError(500, 'run_lookup_failed', 'Could not load the training automation run.');
  if (!result.data) return jsonError(404, 'run_not_found', 'That training automation run was not found.');
  return jsonWithCors({ run: result.data });
}
