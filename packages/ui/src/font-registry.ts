export type FontWeight = 400 | 600 | 700;

export type RegisteredFont = {
  family: string;
  packageName: string | null;
  faces: Record<FontWeight, string>;
};

/**
 * Fonts bundled by every native app today.
 *
 * A tenant may always choose System. Adding another family is a deliberate
 * release change: install its Expo package in each native app, add its static
 * imports to the app font loader, then register its face names here. Keeping
 * the registry honest prevents a valid-looking brand.json from shipping text
 * in an unintended fallback face.
 */
export const FONT_REGISTRY: Readonly<Record<string, RegisteredFont>> = {
  System: {
    family: 'System',
    packageName: null,
    faces: { 400: 'System', 600: 'System', 700: 'System' },
  },
  Inter: {
    family: 'Inter',
    packageName: '@expo-google-fonts/inter',
    faces: { 400: 'Inter_400Regular', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold' },
  },
  Fraunces: {
    family: 'Fraunces',
    packageName: '@expo-google-fonts/fraunces',
    faces: { 400: 'Fraunces_700Bold', 600: 'Fraunces_700Bold', 700: 'Fraunces_700Bold' },
  },
};

/** Returns the bundled native face for a tenant family and weight. */
export function resolveFontFace(family: string, weight: FontWeight): string {
  return FONT_REGISTRY[family]?.faces[weight] ?? FONT_REGISTRY.System!.faces[weight];
}

/** Whether a tenant family can render without adding a native dependency. */
export function isRegisteredFont(family: string): boolean {
  return Object.hasOwn(FONT_REGISTRY, family);
}
