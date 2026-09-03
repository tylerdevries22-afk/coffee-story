/**
 * The kiosk's flow, declared by the tenant rather than by this code.
 *
 * A kiosk in a coffee shop and a kiosk in a bakery ask different first
 * questions and take different middle steps, and neither of them should need a
 * release to change. So the whole shape of the flow -- what the first screen
 * offers, which step family runs, which tenders appear, whether a name is
 * asked for -- is data in `brand_config.kiosk`, resolved here.
 *
 * The resolver follows `resolveTokens` (packages/ui/src/tokens.ts) rather than
 * `parseTaxJurisdictions` (packages/engine/src/tax.ts): a bad field is clamped
 * or dropped, never fatal. Throwing is the right answer when the alternative is
 * undercharging tax; it is the wrong answer when the alternative is a kiosk
 * that will not open because someone mistyped one entry label.
 *
 * The tenant's menu is an input, not an assumption. That is what lets the
 * resolver drop a tile pointing at a category somebody deleted last week --
 * a dead button on a guest-facing screen is the most likely way this config
 * goes wrong, and it is invisible to any check that only reads the config.
 *
 * Framework-free, so `node:test` covers every rule below without a renderer.
 *
 * Split by concern into `kiosk-flow/`: the resolved shape and its defaults
 * (types), the entry screen derived from the menu (entry-derived) and the one a
 * tenant drew (entry-nodes), payment (tenders), the remaining field readers
 * (readers) and the walk that drives them (resolve). Bounds (limits) and shape
 * checks (primitives) are shared by all of them and stay internal, which is why
 * only the three named constants below are re-exported rather than the module.
 */
export * from './kiosk-flow/types';
export * from './kiosk-flow/resolve';
export { KIOSK_IDLE_MAX_MS, KIOSK_IDLE_MIN_MS, MAX_ENTRY_NODES } from './kiosk-flow/limits';
export { entryNodesFromCategories } from './kiosk-flow/entry-derived';
export { settlementFor, wireTendersFor, type KioskTenderSettlement } from './kiosk-flow/tenders';
