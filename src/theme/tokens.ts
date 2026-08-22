// Staged replacement for src/theme/tokens.ts — applied after the source copy lands.
//
// Coffee Story palette: "Espresso & Cream". The plum brand ramp becomes a
// coffee ramp (latte → espresso), the gold ramp becomes caramel/crema, and the
// ink neutrals go warm. Token *names* are unchanged so every screen picks the
// new brand up with no call-site edits.
export const colors = {
  brand50: '#FAF5EF',
  brand100: '#F3EAE0',
  brand200: '#E4D3C3',
  brand300: '#C9A88C',
  brand400: '#A87E5F',
  brand500: '#7D5A3C',
  brand600: '#644631',
  brand700: '#4C3626',
  // Deep espresso — the surface the admin drawer and dark UI paint with.
  brand800: '#362518',
  brand900: '#241710',
  gold50: '#FBF3E4',
  gold300: '#E8C48C',
  // Caramel — sits between 300 and 500 for selected accents.
  gold400: '#D9A45B',
  gold500: '#C08A3E',
  ink900: '#1F1610',
  ink700: '#3D2F26',
  ink500: '#6E5B4C',
  // Muted copy on the pale cream surfaces. Clears WCAG AA on brand100 and
  // stays visibly lighter than ink700, so the body/muted hierarchy survives.
  // Pinned by src/theme/contrast.test.ts.
  ink600: '#57483B',
  ink400: '#9C8A7A',
  ink300: '#CBBBA9',
  ink200: '#E8DCCF',
  white: '#FFFFFF',
  surface: '#FFFDF8',
  warm: '#FAF5EE',
  // Darkened from #3E6B4F / #9A5B24 / #A04038, which measured 4.21 / 3.70 /
  // 4.38 against brand200 -- the order flow's page surface, where the
  // validation and payment errors are drawn. All three now clear AA on every
  // surface in theme/contrast.test.ts, and white on each of them is still
  // above 6.5:1, so the badges and marks that use them as a fill are unaffected.
  success: '#3B664B',
  warning: '#864F1F',
  danger: '#9D3F37',
  siriCyan: '#5FD4F5',
  siriBlue: '#5E8CF0',
  siriPurple: '#9D6BF5',
  siriPink: '#F27AC2',
} as const;

export const radius = { sm: 12, md: 18, lg: 26, xl: 34, pill: 999 } as const;
export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

/**
 * The dim behind every sheet, dialog and speed dial.
 *
 * Held as a solid colour plus a target opacity rather than a baked `rgba()`
 * so the scrim can be *animated* to that opacity.
 */
export const scrim = { color: colors.brand900, opacity: 0.45 } as const;

/**
 * Shared entrance/exit timings. Exits run shorter than entrances: a dismissal
 * the user just asked for should feel immediate, an arrival should feel placed.
 */
export const motion = { enterMs: 280, exitMs: 220 } as const;
export const shadow = {
  card: {
    shadowColor: colors.brand900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 5,
  },
} as const;

export const fonts = {
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  display: 'Fraunces_700Bold',
} as const;
