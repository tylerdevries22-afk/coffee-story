/**
 * Whether this deployment is talking to a real Supabase project, and whether
 * it is allowed to pretend otherwise.
 *
 * `isConfigured` was defined twice, byte-identical, in auth.ts and
 * supabase-server.ts. Both still export it so callers do not move, but the
 * rule lives here once -- a security predicate with two copies is one edit
 * away from two different answers.
 */
import { previewWallRuntimeEnabled } from './demo-sync-http';

export function isConfigured(): boolean {
  return !previewWallRuntimeEnabled()
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Whether an unconfigured deployment may fall back to the demo fixtures.
 *
 * Never in production. The fallback exists so the console is reviewable with
 * no database, and DEMO_SESSION is a `platform_admin` -- so a production
 * deployment that lost NEXT_PUBLIC_SUPABASE_URL answered every "who is signed
 * in?" with a hard-coded administrator and rendered the console to anyone who
 * asked. Middleware waves the request through when that variable is missing,
 * and the layout's tenant gate was itself conditioned on being configured, so
 * nothing downstream caught it.
 *
 * No real data was reachable in that state -- the service-role paths are held
 * shut by DEMO_SESSION carrying a null userId, and page reads need a client
 * that does not exist. The failure is that it looked healthy: a misconfigured
 * production deploy served a convincing fake console instead of erroring, and
 * the missing variable stayed invisible.
 *
 * The two service environment variables are independent of these two
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY against NEXT_PUBLIC_*), so
 * "unconfigured" never meant "holds no credentials" -- which is exactly why
 * this cannot be left to whether the fixtures happen to be harmless today.
 */
export function demoFallbackAllowed(
  env: { NODE_ENV?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production';
}
