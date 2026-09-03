import { createClient } from '@supabase/supabase-js';
import { liftTrainingManifest, type TenantTrainingProfile, type TrainingManifest } from '@platform/domain';
import { FatalError } from 'workflow';

/**
 * Every outbound request in this workflow retries once and carries a deadline.
 * The research provider answers in minutes, and a hung socket would otherwise
 * hold a workflow step open until the platform's own much longer timeout.
 */
export async function fetchWithRetry(url: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`Research provider returned ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Research provider request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Research provider request failed');
}

export function database() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new FatalError('Training automation database is not configured.');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetchWithRetry(input, init ?? {}) },
  });
}

/**
 * A published template may have been written under any schema this platform
 * has shipped, so it goes through the same lift as a tenant release rather
 * than a shape check of its own.
 */
export async function loadTemplate(profile: TenantTrainingProfile): Promise<TrainingManifest | null> {
  if (!profile.templateKey) return null;
  const query = database().from('training_templates').select('manifest')
    .eq('template_key', profile.templateKey).eq('status', 'published');
  const result = Number.isInteger(profile.templateVersion) && (profile.templateVersion ?? 0) > 0
    ? await query.eq('version', profile.templateVersion).maybeSingle<{ manifest: unknown }>()
    : await query.order('version', { ascending: false }).limit(1).maybeSingle<{ manifest: unknown }>();
  if (result.error) return null;
  return liftTrainingManifest(result.data?.manifest);
}
