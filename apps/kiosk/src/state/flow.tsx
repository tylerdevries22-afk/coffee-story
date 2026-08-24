import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import { resolveKioskFlow, type KioskFlow, type KioskMenuFacts } from '@platform/domain';

import {
  EMPTY_FACTS, STEP_ROUTES, backStep, canAdvance, nextStep, recoveryStep, stepsFor,
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
  step: KioskStepId;
  steps: readonly KioskStepId[];
  canAdvance: boolean;
  backTarget: KioskStepId | null;
  /** Merge in what the guest just did. */
  learn: (facts: Partial<FlowFacts>) => void;
  goNext: () => void;
  goBack: () => void;
  goTo: (step: KioskStepId) => void;
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
  const [facts, setFacts] = useState<FlowFacts>(EMPTY_FACTS);
  const [step, setStep] = useState<KioskStepId>('entry');

  const flow = useMemo(
    () => resolveKioskFlow(brandConfig, { menu, features: { stored_value: storedValue } }),
    [brandConfig, menu, storedValue],
  );

  const navigate = useCallback((target: KioskStepId) => {
    setStep(target);
    // The one cast. `typedRoutes` builds its Href union from generated types
    // the dev server refreshes, so keeping the table as strings is what stops a
    // CI typecheck failing on stale codegen.
    router.replace(STEP_ROUTES[target] as never);
  }, [router]);

  const value = useMemo<FlowValue>(() => {
    const steps = stepsFor(flow, facts);
    // A guest who deep-links or lands somewhere the facts no longer support is
    // moved, rather than left on a screen whose only action is dead.
    const safeStep = recoveryStep(flow, facts, step);
    return {
      flow,
      facts,
      step: safeStep,
      steps,
      canAdvance: canAdvance(flow, facts, safeStep),
      backTarget: backStep(flow, facts, safeStep),
      learn: (next) => setFacts((current) => ({ ...current, ...next })),
      goNext: () => {
        const target = nextStep(flow, facts, safeStep);
        if (target) navigate(target);
      },
      goBack: () => {
        const target = backStep(flow, facts, safeStep);
        if (target) navigate(target);
      },
      goTo: navigate,
      startOver: () => {
        setFacts(EMPTY_FACTS);
        setStep('entry');
        router.replace('/');
      },
    };
  }, [flow, facts, step, navigate, router]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowValue {
  const value = useContext(FlowContext);
  if (!value) throw new Error('useFlow must be used inside FlowProvider');
  return value;
}
