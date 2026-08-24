import { usePathname, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import {
  resolveKioskFlow,
  type KioskEntryNode,
  type KioskFlow,
  type KioskMenuFacts,
  type KioskUtility,
} from '@platform/domain';

import {
  EMPTY_FACTS, STEP_ROUTES, backStep, canAdvance, factsForAdvance, nextStep, recoveryStep, stepForRoute, stepsFor,
  type FlowFacts, type KioskStepId,
} from '@/features/step-flow';

/**
 * The tenant's flow, and where the guest is in it.
 *
 * Navigation goes through here rather than through `router.push` at each
 * screen, because the sequence is a property of the tenant's config plus what
 * the guest has done -- not of what the previous screen happened to know. It is
 * also the only place `STEP_ROUTES` is cast to a route, which keeps
 * `step-flow.ts` importable by `node:test` without pulling in expo-router.
 */
type FlowValue = {
  flow: KioskFlow;
  facts: FlowFacts;
  /** The tile the guest tapped on the first screen, and any group under it. */
  selected: KioskEntryNode | null;
  group: readonly KioskEntryNode[];
  select: (node: KioskEntryNode) => void;
  step: KioskStepId;
  steps: readonly KioskStepId[];
  canAdvance: boolean;
  backTarget: KioskStepId | null;
  /** Merge in what the guest just did. */
  learn: (facts: Partial<FlowFacts>) => void;
  /**
   * Advance, optionally carrying facts learned in the same handler.
   *
   * `learn()` is a state update, so a screen that called `learn()` and then
   * `goNext()` advanced using the PREVIOUS facts -- which silently skipped the
   * options step for every drink, because `hasOptions` had not landed yet.
   * Passing them through here makes the two atomic.
   */
  goNext: (learned?: Partial<FlowFacts>) => void;
  goBack: () => void;
  goTo: (step: KioskStepId) => void;
  activeUtility: KioskUtility | null;
  openUtility: (utility: KioskUtility) => void;
  closeUtility: () => void;
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  /** Clear flow facts and enter ordering without visiting browser history. */
  beginOrder: () => void;
  startOver: () => void;
};

const FlowContext = createContext<FlowValue | null>(null);

export function FlowProvider({
  brandConfig,
  menu,
  storedValue,
  children,
}: PropsWithChildren<{
  brandConfig: unknown;
  menu: KioskMenuFacts;
  /** The brand's stored_value feature column; a config cannot grant it itself. */
  storedValue: boolean;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const [rawFacts, setFacts] = useState<FlowFacts>(EMPTY_FACTS);
  const [selected, setSelected] = useState<KioskEntryNode | null>(null);
  const [activeUtility, setActiveUtility] = useState<KioskUtility | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const flow = useMemo(
    () => resolveKioskFlow(brandConfig, { menu, features: { stored_value: storedValue } }),
    [brandConfig, menu, storedValue],
  );

  const navigate = useCallback((target: KioskStepId) => {
    // The one cast. `typedRoutes` builds its Href union from generated types
    // the dev server refreshes, so keeping the table as strings is what stops a
    // CI typecheck failing on stale codegen.
    router.replace(STEP_ROUTES[target] as never);
  }, [router]);

  const openUtility = useCallback((utility: KioskUtility) => {
    setCartOpen(false);
    setActiveUtility(utility);
  }, []);
  const closeUtility = useCallback(() => {
    setActiveUtility(null);
  }, []);
  const openCart = useCallback(() => {
    setActiveUtility(null);
    setCartOpen(true);
  }, []);
  const closeCart = useCallback(() => {
    setCartOpen(false);
  }, []);

  const resetFlowState = useCallback(() => {
    setActiveUtility(null);
    setCartOpen(false);
    setFacts(EMPTY_FACTS);
    setSelected(null);
  }, []);

  const value = useMemo<FlowValue>(() => {
    /**
     * Facts the TENANT decides, rather than the guest.
     *
     * Whether a name is asked for is `brand_config.kiosk.guestName.mode`, so
     * deriving it here means no screen has to remember to announce it -- and a
     * tenant switching it off removes the step everywhere at once.
     */
    const facts: FlowFacts = { ...rawFacts, wantsName: flow.guestName.mode !== 'off' };
    const steps = stepsFor(flow, facts);
    const routeStep = stepForRoute(pathname) ?? 'entry';
    // A guest who deep-links or lands somewhere the facts no longer support is
    // moved, rather than left on a screen whose only action is dead.
    const safeStep = recoveryStep(flow, facts, routeStep);
    return {
      flow,
      facts,
      selected,
      group: selected?.target.kind === 'group' ? selected.target.nodes : [],
      select: setSelected,
      step: safeStep,
      steps,
      canAdvance: canAdvance(flow, facts, safeStep),
      backTarget: backStep(flow, facts, safeStep),
      learn: (next) => setFacts((current) => ({ ...current, ...next })),
      goNext: (learned) => {
        if (learned) setFacts((current) => ({ ...current, ...learned }));
        const target = nextStep(flow, factsForAdvance(facts, learned), safeStep);
        if (target) navigate(target);
      },
      goBack: () => {
        const target = backStep(flow, facts, safeStep);
        if (target) navigate(target);
      },
      goTo: navigate,
      activeUtility,
      openUtility,
      closeUtility,
      cartOpen,
      openCart,
      closeCart,
      beginOrder: () => {
        resetFlowState();
        router.replace(STEP_ROUTES.entry as never);
      },
      startOver: () => {
        resetFlowState();
        router.replace('/');
      },
    };
  }, [
    flow, rawFacts, selected, pathname, navigate, router, activeUtility, cartOpen,
    openUtility, closeUtility, openCart, closeCart, resetFlowState,
  ]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const value = useContext(FlowContext);
  if (!value) throw new Error('useFlow must be used inside FlowProvider');
  return value;
}
