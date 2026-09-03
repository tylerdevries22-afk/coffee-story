import { normalizeTrainingManifest, type TrainingManifest, type TrainingModule } from './training';

/**
 * The one reader for a stored training release.
 *
 * Schema 3 renames the array of tracks from `modules` to `tracks`, and every
 * release published before it is still sitting in `training_releases` under the
 * old key. Readers therefore have to accept both spellings, and they have to
 * accept the new one *before* any writer emits it -- an operator running last
 * week's build against a release published by this week's HQ would otherwise
 * see "The published training release is invalid." with nothing to retry.
 *
 * Returns null rather than throwing so each caller can phrase its own failure:
 * the operator data layer raises, the HQ workspace falls back to a starter.
 */
export function liftTrainingManifest(value: unknown): TrainingManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<TrainingManifest> & { tracks?: unknown };
  const version = candidate.schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3) return null;
  if (!candidate.tenant || !Array.isArray(candidate.sources)) return null;
  const nodes = version === 3 ? candidate.tracks : candidate.modules;
  if (!Array.isArray(nodes)) return null;
  return normalizeTrainingManifest({
    ...candidate,
    schemaVersion: version === 3 ? 2 : version,
    modules: nodes as TrainingModule[],
  } as TrainingManifest);
}
