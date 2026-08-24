import { createContext, useCallback, useContext, useMemo, useReducer, type PropsWithChildren } from 'react';

import {
  buildOrderLine, defaultOptionSelection, missingRequiredGroups, optionDeltaCents,
  optionGroupsFor, pruneHiddenGroups, sizeLabelFor, sizePriceCents, toggleOptionChoice,
  visibleOptionGroups,
  type KioskMenuItem as MenuItem, type MenuCategoryId, type OptionGroup,
  type OptionSelection, type OrderLine,
} from '@platform/domain';

import { EMPTY_FILL, allocate, isComplete, packSummary, release, remaining, type PackFill } from '@/features/pack-fill';

/**
 * The line a guest is currently building.
 *
 * Kept apart from the cart because it is the HOT state on this surface: every
 * tap on a size, an option or a pack choice writes here, and the cart does not
 * move until "Add to bag". Holding both in one provider re-rendered the bag and
 * the chrome on every tap of a twenty-tile grid.
 */
type BuilderState = {
  item: MenuItem | null;
  sizeSlug: string | null;
  selection: OptionSelection;
  quantity: number;
  /** Container family only: choice id -> how many are in the box. */
  fill: PackFill;
};

const EMPTY: BuilderState = { item: null, sizeSlug: null, selection: {}, quantity: 1, fill: EMPTY_FILL };

type BuilderEvent =
  | { type: 'choose'; item: MenuItem }
  | { type: 'size'; sizeSlug: string }
  | { type: 'toggle'; groupId: string; choiceId: string }
  | { type: 'quantity'; delta: number }
  | { type: 'allocate'; choiceId: string; packSize: number }
  | { type: 'release'; choiceId: string }
  | { type: 'reset' };

/** Max 20 per line, matching `MAX_LINE_QUANTITY` in the domain cart. */
const MAX_QUANTITY = 20;

function reducer(state: BuilderState, event: BuilderEvent): BuilderState {
  switch (event.type) {
    case 'choose': {
      const groups = groupsOf(event.item);
      return {
        ...EMPTY,
        item: event.item,
        // The first size is the shop's default pour, not a guess.
        sizeSlug: event.item.sizes[0]?.slug ?? null,
        selection: defaultOptionSelection(groups),
      };
    }
    case 'size':
      return { ...state, sizeSlug: event.sizeSlug };
    case 'toggle': {
      if (!state.item) return state;
      const groups = groupsOf(state.item);
      const next = toggleOptionChoice(groups, state.selection, event.groupId, event.choiceId);
      // Choosing "hot" hides the ice group; its selection must go with it or a
      // hidden answer keeps being priced.
      return { ...state, selection: pruneHiddenGroups(groups, next) };
    }
    case 'quantity':
      return { ...state, quantity: Math.min(MAX_QUANTITY, Math.max(1, state.quantity + event.delta)) };
    case 'allocate':
      return { ...state, fill: allocate({ packSize: event.packSize }, state.fill, event.choiceId) };
    case 'release':
      return { ...state, fill: release(state.fill, event.choiceId) };
    case 'reset':
      return EMPTY;
    default:
      return state;
  }
}

function groupsOf(item: MenuItem): OptionGroup[] {
  return optionGroupsFor(item.id, item.categoryId as MenuCategoryId);
}

type BuilderValue = {
  state: BuilderState;
  /** Option groups still visible given what has been chosen. */
  visibleGroups: readonly OptionGroup[];
  /** Groups that must be answered before this line can be added. */
  missingGroups: readonly OptionGroup[];
  /** Unit price including size and options, in integer cents. */
  unitPriceCents: number;
  lineTotalCents: number;
  packRemaining: (packSize: number) => number;
  packComplete: (packSize: number) => boolean;
  packSummaryText: (nameOf: (id: string) => string) => string;
  /** The line to add, or null when it is not yet answerable. */
  toOrderLine: () => OrderLine | null;
  choose: (item: MenuItem) => void;
  setSize: (sizeSlug: string) => void;
  toggle: (groupId: string, choiceId: string) => void;
  changeQuantity: (delta: number) => void;
  allocateChoice: (choiceId: string, packSize: number) => void;
  releaseChoice: (choiceId: string) => void;
  reset: () => void;
};

const BuilderContext = createContext<BuilderValue | null>(null);

export function BuilderProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, EMPTY);

  const groups = useMemo(() => (state.item ? groupsOf(state.item) : []), [state.item]);
  const visible = useMemo(() => visibleOptionGroups(groups, state.selection), [groups, state.selection]);
  const missing = useMemo(
    () => missingRequiredGroups(groups, state.selection),
    [groups, state.selection],
  );

  const size = state.item?.sizes.find((entry) => entry.slug === state.sizeSlug) ?? state.item?.sizes[0];
  const unitPriceCents = size
    ? sizePriceCents(size) + optionDeltaCents(groups, state.selection)
    : 0;

  const toOrderLine = useCallback((): OrderLine | null => {
    if (!state.item || !size) return null;
    if (missing.length > 0) return null;
    return buildOrderLine({
      itemId: state.item.id,
      name: state.item.name,
      sizeSlug: size.slug,
      sizeLabel: sizeLabelFor(size.slug),
      basePriceCents: sizePriceCents(size),
      groups,
      selection: state.selection,
      quantity: state.quantity,
    });
  }, [state.item, state.selection, state.quantity, size, groups, missing.length]);

  const value = useMemo<BuilderValue>(() => ({
    state,
    visibleGroups: visible,
    missingGroups: missing,
    unitPriceCents,
    lineTotalCents: unitPriceCents * state.quantity,
    packRemaining: (packSize) => remaining({ packSize }, state.fill),
    packComplete: (packSize) => isComplete({ packSize }, state.fill),
    packSummaryText: (nameOf) => packSummary(state.fill, nameOf),
    toOrderLine,
    choose: (item) => dispatch({ type: 'choose', item }),
    setSize: (sizeSlug) => dispatch({ type: 'size', sizeSlug }),
    toggle: (groupId, choiceId) => dispatch({ type: 'toggle', groupId, choiceId }),
    changeQuantity: (delta) => dispatch({ type: 'quantity', delta }),
    allocateChoice: (choiceId, packSize) => dispatch({ type: 'allocate', choiceId, packSize }),
    releaseChoice: (choiceId) => dispatch({ type: 'release', choiceId }),
    reset: () => dispatch({ type: 'reset' }),
  }), [state, visible, missing, unitPriceCents, toOrderLine]);

  return <BuilderContext.Provider value={value}>{children}</BuilderContext.Provider>;
}

export function useBuilder(): BuilderValue {
  const value = useContext(BuilderContext);
  if (!value) throw new Error('useBuilder must be used inside BuilderProvider');
  return value;
}
