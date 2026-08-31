// Staged replacement for src/data/add-ons.ts
//
// Drink customizations. Kept in a pure module (no image imports) so the
// contract stays unit-testable.
//
// No supplier is named here. This described the extra shot as the first
// tenant's roaster by name, from a shared package, so a shop pulling anyone
// else's beans still advertised theirs. A tenant that wants to name its
// roaster says so in its own menu copy, where the answer differs per shop.
export const DEMO_ADD_ONS = [
  { slug: 'extra-shot', name: 'Extra Espresso Shot', priceCents: 150, durationMin: 0, description: 'An extra pull of espresso in any drink.' },
  { slug: 'oat-milk', name: 'Oat Milk', priceCents: 75, durationMin: 0, description: 'Swap in creamy oat milk.' },
  { slug: 'boba-pearls', name: 'Boba Pearls', priceCents: 100, durationMin: 0, description: 'Chewy brown-sugar boba added to any iced drink.' },
  { slug: 'pistachio-cold-foam', name: 'Pistachio Cold Foam', priceCents: 125, durationMin: 0, description: 'A cloud of pistachio cream on top.' },
] as const;
