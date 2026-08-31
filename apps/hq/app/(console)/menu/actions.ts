'use server';

/**
 * Import a menu from a CSV paste, so a new tenant fills its catalog in one step
 * instead of an engineer running the seed script. The CSV is the same contract
 * the onboarding pipeline reads (slug,name,category,description,base_price_cents,
 * sizes), parsed by the shared, unit-tested parser so the two paths cannot
 * drift.
 *
 * Home owners use an invariant-preserving authenticated RPC. Platform support
 * uses the audited service-only companion. Rows upsert on natural keys, so a
 * re-import is idempotent. In demo mode the parse still runs and reports what
 * would land, keeping the flow reviewable without infrastructure.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseMenuCsv } from '@platform/schema';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import {
  extractMenuFromSource, validateMenuSource, validateMenuSourceMetadata,
} from '@/lib/menu-ingestion';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

export type MenuExtractionState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; csv: string };

export async function extractMenuAction(
  _previous: MenuExtractionState,
  formData: FormData,
): Promise<MenuExtractionState> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) {
    return { kind: 'error', message: 'Only a brand owner can prepare a menu import.' };
  }
  const mutation = await authorizeWorkspaceMutation(session, { action: 'menu.extract' });
  if (!mutation) return { kind: 'error', message: 'This organization is not authorized.' };
  const file = formData.get('menuFile');
  if (!(file instanceof File)) return { kind: 'error', message: 'Choose a menu file.' };
  const metadataError = validateMenuSourceMetadata({ mime: file.type, size: file.size });
  if (metadataError) return { kind: 'error', message: metadataError };
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MENU_MODEL ?? process.env.OPENAI_RESEARCH_MODEL;
  if (!apiKey || !model) return { kind: 'error', message: 'Menu extraction is not configured.' };
  if (!isConfigured()) {
    return { kind: 'error', message: 'Menu extraction requires a configured database.' };
  }
  const client = await serverClient();
  if (!client) return { kind: 'error', message: 'Menu extraction is not configured.' };
  const source = {
    bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mime: file.type,
  };
  const sourceError = validateMenuSource(source);
  if (sourceError) return { kind: 'error', message: sourceError };
  const budget = await client.rpc('consume_menu_extraction_budget', {
    p_brand_id: mutation.brandId,
  });
  if (budget.error || budget.data !== true) {
    return { kind: 'error', message: 'The hourly menu extraction limit has been reached. Try again later.' };
  }
  try {
    const csv = await extractMenuFromSource(source, { apiKey, model, brandId: mutation.brandId });
    return { kind: 'ready', csv };
  } catch {
    return { kind: 'error', message: 'The file could not be transcribed safely. Try a clearer image or paste CSV.' };
  }
}

function fail(message: string): never {
  redirect(`/menu/import?error=${encodeURIComponent(message)}`);
}

// A single paste seeds one brand's catalog, not a bulk data load; a sane ceiling
// keeps one import from issuing an unbounded upsert (and one mistaken paste from
// trying to write tens of thousands of rows under the owner's RLS in one call).
const MAX_MENU_ROWS = 500;

export async function importMenuAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) redirect('/menu?imported=denied');

  const csv = String(formData.get('csv') ?? '');
  const { rows, errors } = parseMenuCsv(csv);
  if (errors.length > 0) fail(errors[0] ?? 'The menu CSV could not be parsed.');
  if (rows.length === 0) fail('The CSV has a header but no menu rows.');
  if (rows.length > MAX_MENU_ROWS) {
    fail(`This import has ${rows.length} rows; a single menu import is limited to ${MAX_MENU_ROWS}. Split it into smaller files.`);
  }

  const mutation = await authorizeWorkspaceMutation(session, { action: 'menu.import' });
  if (!mutation) fail('You are not authorized to import this organization’s menu.');
  if (!isConfigured()) {
    // Demo: nothing to write, but the parse is real -- report what would land.
    redirect(`/menu?imported=${rows.length}&preview=1`);
  }

  const client = await serverClient();
  if (!client) fail('This deployment is not connected to Supabase.');

  const input = { p_brand_id: mutation.brandId, p_rows: rows };
  const environment = mutation.serviceRole ? serverEnv() : null;
  if (mutation.serviceRole && (!environment || !session.userId || !mutation.auditCorrelationId)) {
    fail('The audited menu writer is not configured.');
  }
  const imported = mutation.serviceRole
    ? await serviceDb(environment!).rpc('import_platform_brand_menu', {
      ...input,
      p_actor_id: session.userId,
      p_correlation_id: mutation.auditCorrelationId,
    })
    : await client.rpc('import_brand_menu', input);
  if (imported.error || imported.data !== rows.length) fail('Could not import the menu items.');

  revalidatePath('/menu');
  redirect(`/menu?imported=${rows.length}`);
}
