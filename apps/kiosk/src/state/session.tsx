import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { EMPTY_CART, addOrderLine, changeOrderLineQuantity, removeOrderLine } from '@platform/domain';
import type { KioskTender, OrderCart, OrderLine } from '@platform/domain';

import { DEFAULT_IDLE_TIMING, idlePhase, type IdlePhase, type IdleTiming } from '@/features/idle';

type SessionValue = {
  cart: OrderCart;
  tipCents: number;
  tender: KioskTender | null;
  /** True only after checkout has crossed a side-effect boundary. */
  committed: boolean;
  idleTiming: IdleTiming;
  idle: IdlePhase;
  /** Bumped by every reset, so navigation can follow one without a callback. */
  resetSeq: number;
  /** Every touch anywhere calls this; the idle clock is a session concern. */
  touch: () => void;
  addLine: (line: OrderLine) => void;
  changeQuantity: (id: string, delta: number) => void;
  removeLine: (id: string) => void;
  setTipCents: (tipCents: number) => void;
  setTender: (tender: KioskTender) => void;
  reset: () => void;
  /**
   * Progress that is not yet a cart line -- a half-built pack. Without this the
   * clock treats a guest four cookies into a six-pack as an untouched screen.
   */
  setBuilding: (building: boolean) => void;
  /** Payment is under way or done. A committed session is never cleared. */
  setCommitted: (committed: boolean) => void;
  /** How long since the last touch. A ref-read, so it costs no render. */
  idleMsNow: () => number;
};

const SessionContext = createContext<SessionValue | null>(null);

export function KioskSessionProvider({
  timing = DEFAULT_IDLE_TIMING,
  idleResets = true,
  children,
}: PropsWithChildren<{ timing?: IdleTiming; idleResets?: boolean }>) {
  const [cart, setCart] = useState<OrderCart>(EMPTY_CART);
  const [tipCents, setTipCentsState] = useState(0);
  const [tender, setTenderState] = useState<KioskTender | null>(null);
  const [isCommitted, setIsCommitted] = useState(false);
  const [idle, setIdle] = useState<IdlePhase>('active');
  const [resetSeq, setResetSeq] = useState(0);

  /**
   * The clock lives in refs, and only a PHASE CROSSING reaches React.
   *
   * This used to be `setIdleMs` on a one-second interval, which rebuilt the
   * context value every second for the life of a session and re-rendered every
   * consumer with it. That is survivable for a screen of text tiles and fatal
   * for a screen of staggered, spring-animated circles -- so fixing it is a
   * precondition for the redesign, not a later optimisation. A phase crosses at
   * most twice per session; the seconds a guest reads are local state inside
   * the notice, which is unmounted the rest of the time.
   */
  const lastTouch = useRef(Date.now());
  const building = useRef(false);
  const committed = useRef(false);
  const phase = useRef<IdlePhase>('active');

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    if (phase.current !== 'active') {
      phase.current = 'active';
      setIdle('active');
    }
  }, []);

  const reset = useCallback(() => {
    setCart(EMPTY_CART);
    setTipCentsState(0);
    setTenderState(null);
    building.current = false;
    committed.current = false;
    setIsCommitted(false);
    setResetSeq((value) => value + 1);
    touch();
  }, [touch]);

  const idleMsNow = useCallback(() => Date.now() - lastTouch.current, []);

  useEffect(() => {
    if (!idleResets) {
      phase.current = 'active';
      setIdle('active');
      return undefined;
    }
    const id = setInterval(() => {
      const next = idlePhase(Date.now() - lastTouch.current, timing, {
        hasProgress: building.current || hasLines.current,
        committed: committed.current,
      });
      if (next !== phase.current) {
        phase.current = next;
        setIdle(next);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [timing, idleResets]);

  // Read by the interval without making the cart a dependency of it.
  const hasLines = useRef(false);
  hasLines.current = cart.lines.length > 0;

  // The reset is the point of the whole clock: the next guest must never find
  // a stranger's session waiting for them.
  useEffect(() => {
    if (idleResets && idle === 'reset') reset();
  }, [idle, idleResets, reset]);

  const value = useMemo<SessionValue>(() => ({
    cart,
    tipCents,
    tender,
    committed: isCommitted,
    idleTiming: timing,
    idle,
    resetSeq,
    touch,
    addLine: (line) => { touch(); setCart((current) => addOrderLine(current, line)); },
    changeQuantity: (id, delta) => { touch(); setCart((current) => changeOrderLineQuantity(current, id, delta)); },
    removeLine: (id) => { touch(); setCart((current) => removeOrderLine(current, id)); },
    setTipCents: (next) => {
      touch();
      setTipCentsState(Math.max(0, Math.trunc(next)));
    },
    setTender: (next) => { touch(); setTenderState(next); },
    reset,
    setBuilding: (next) => { building.current = next; },
    setCommitted: (next) => {
      committed.current = next;
      setIsCommitted(next);
    },
    idleMsNow,
  }), [cart, tipCents, tender, isCommitted, timing, idle, resetSeq, touch, reset, idleMsNow]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useKioskSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useKioskSession must be used inside KioskSessionProvider');
  return value;
}
