import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { EMPTY_CART, addOrderLine, changeOrderLineQuantity, removeOrderLine } from '@platform/domain';
import type { OrderCart, OrderLine } from '@platform/domain';

import { idlePhase, secondsUntilReset, type IdlePhase } from '@/features/idle';
import { postureFor, type KioskPosture } from '@/features/kiosk-mode';

/** Until a device pairs, the binary runs as an unattended lobby kiosk. */
const DEFAULT_POSTURE = postureFor('kiosk')!;

type SessionValue = {
  cart: OrderCart;
  posture: KioskPosture;
  idle: IdlePhase;
  secondsLeft: number;
  /** Every touch anywhere calls this; the idle clock is a session concern. */
  touch: () => void;
  addLine: (line: OrderLine) => void;
  changeQuantity: (id: string, delta: number) => void;
  removeLine: (id: string) => void;
  reset: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function KioskSessionProvider({ children }: PropsWithChildren) {
  const [cart, setCart] = useState<OrderCart>(EMPTY_CART);
  const [idleMs, setIdleMs] = useState(0);
  const lastTouch = useRef(Date.now());
  const posture = DEFAULT_POSTURE;

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    setIdleMs(0);
  }, []);

  const reset = useCallback(() => {
    setCart(EMPTY_CART);
    touch();
  }, [touch]);

  useEffect(() => {
    if (!posture.idleResets) return;
    const id = setInterval(() => setIdleMs(Date.now() - lastTouch.current), 1_000);
    return () => clearInterval(id);
  }, [posture.idleResets]);

  const hasCart = cart.lines.length > 0;
  const idle = posture.idleResets ? idlePhase(idleMs, hasCart) : 'active';

  // The reset is the point of the whole clock: the next guest must never find
  // a stranger's bag waiting for them.
  useEffect(() => {
    if (idle === 'reset') reset();
  }, [idle, reset]);

  const value = useMemo<SessionValue>(() => ({
    cart,
    posture,
    idle,
    secondsLeft: secondsUntilReset(idleMs),
    touch,
    addLine: (line) => { touch(); setCart((current) => addOrderLine(current, line)); },
    changeQuantity: (id, delta) => { touch(); setCart((current) => changeOrderLineQuantity(current, id, delta)); },
    removeLine: (id) => { touch(); setCart((current) => removeOrderLine(current, id)); },
    reset,
  }), [cart, posture, idle, idleMs, touch, reset]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useKioskSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useKioskSession must be used inside KioskSessionProvider');
  return value;
}
