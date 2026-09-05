import { FACTORY_SURFACES, type FactorySurface } from '@platform/factory';

export type FactorySurfacePlan = Readonly<{
  all: readonly FactorySurface[];
  web: readonly Exclude<FactorySurface, 'hq'>[];
  native: readonly Extract<FactorySurface, 'customer' | 'operator' | 'kiosk'>[];
}>;

const DEFAULTS: Readonly<Record<string, readonly FactorySurface[]>> = {
  'coffee-shop': FACTORY_SURFACES,
  construction: FACTORY_SURFACES,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function declaredSurfaces(manifest: unknown): unknown {
  const source = record(manifest);
  const declaration = source?.applicationSurfaces ?? source?.surfaces;
  if (Array.isArray(declaration)) return declaration;
  const flags = record(declaration);
  if (!flags) return undefined;
  return FACTORY_SURFACES.filter((surface) => {
    if (surface === 'customer') return flags.customer === true || flags.guest === true;
    return flags[surface] === true;
  });
}

export function factorySurfacePlan(industryKey: string, manifest?: unknown): FactorySurfacePlan {
  const declaration = declaredSurfaces(manifest) ?? DEFAULTS[industryKey];
  if (!Array.isArray(declaration)) {
    throw new Error(`Industry ${industryKey} must declare its application surfaces.`);
  }
  const unknown = declaration.filter((surface) => (
    typeof surface !== 'string' || !FACTORY_SURFACES.includes(surface as FactorySurface)
  ));
  if (unknown.length > 0) throw new Error('Industry blueprint declares an unsupported application surface.');
  if (new Set(declaration).size !== declaration.length) {
    throw new Error('Industry blueprint application surfaces must be unique.');
  }
  const requested = new Set(declaration as FactorySurface[]);
  requested.add('hq');
  const all = FACTORY_SURFACES.filter((surface) => requested.has(surface));
  const web = all.filter((surface): surface is Exclude<FactorySurface, 'hq'> => surface !== 'hq');
  const native = all.filter((surface): surface is FactorySurfacePlan['native'][number] => (
    surface === 'customer' || surface === 'operator' || surface === 'kiosk'
  ));
  return Object.freeze({ all, web, native });
}
