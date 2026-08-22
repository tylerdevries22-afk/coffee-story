/**
 * The in-flight order: where it is going, when it is wanted, what is in the
 * bag, and how much of a tip is on it.
 *
 * It lives above the tab shell rather than inside the order screen so a guest
 * can add a drink, look at their rewards, and come back to a bag that is still
 * there. It is deliberately *not* persisted to disk: prices, hours and
 * availability all move, and an order restored from last week would be priced
 * against a menu the shop no longer sells. Closing the app clears the bag,
 * which is the same promise the pickup window on the header makes.
 */
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import type { BookingFulfillment } from '@/features/booking/fulfillment';
import {
  EMPTY_CART,
  addOrderLine,
  addableQuantity,
  changeOrderLineQuantity,
  clearOrderCart,
  isCartEmpty,
  orderItemCount,
  orderSubtotalCents,
  removeOrderLine,
  setOrderNote,
  type OrderCart,
  type OrderLine,
} from '@/features/order/cart';
import { DELIVERY_FEE_CENTS } from '@/features/order/totals';

export type OrderState = {
  cart: OrderCart;
  itemCount: number;
  subtotalCents: number;
  isEmpty: boolean;
  /** 0 for pickup; the flat fee once a delivery address is chosen. */
  deliveryFeeCents: number;

  fulfillment: BookingFulfillment | null;
  /** ISO instant of the chosen pickup/delivery window. */
  windowValue: string | null;
  /** Whose name the order is called out under. */
  guestName: string;
  tipCents: number;

  /** Returns how many were actually added; less than asked when the line is full. */
  addLine: (line: OrderLine) => number;
  changeQuantity: (lineId: string, delta: number) => void;
  removeLine: (lineId: string) => void;
  setNote: (note: string) => void;

  setFulfillment: (fulfillment: BookingFulfillment | null) => void;
  setWindowValue: (value: string | null) => void;
  setGuestName: (name: string) => void;
  setTipCents: (cents: number) => void;

  /** After a placed order, and when the guest changes where it is going. */
  clearBag: () => void;
  resetOrder: () => void;
};

const OrderContext = createContext<OrderState | null>(null);

export function OrderProvider({ children }: PropsWithChildren) {
  const [cart, setCart] = useState<OrderCart>(EMPTY_CART);
  const [fulfillment, setFulfillmentState] = useState<BookingFulfillment | null>(null);
  const [windowValue, setWindowValue] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [tipCents, setTipCentsState] = useState(0);

  const addLine = useCallback((line: OrderLine) => {
    // Measured against the cart this render is showing, which is the cart the
    // guest is looking at when they press Add.
    const added = addableQuantity(cart, line);
    if (added > 0) setCart((current) => addOrderLine(current, line));
    return added;
  }, [cart]);
  const changeQuantity = useCallback(
    (lineId: string, delta: number) => setCart((current) => changeOrderLineQuantity(current, lineId, delta)),
    [],
  );
  const removeLine = useCallback((lineId: string) => setCart((current) => removeOrderLine(current, lineId)), []);
  const setNote = useCallback((note: string) => setCart((current) => setOrderNote(current, note)), []);
  const clearBag = useCallback(() => setCart(clearOrderCart()), []);

  const setFulfillment = useCallback((next: BookingFulfillment | null) => {
    setFulfillmentState(next);
    // A pickup window belongs to the place it was chosen for. Switching from
    // the shop to a delivery address, or between shops, has to drop it rather
    // than carry a time the new destination never offered.
    setWindowValue(null);
  }, []);

  const setTipCents = useCallback((cents: number) => {
    setTipCentsState(Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0);
  }, []);

  const resetOrder = useCallback(() => {
    setCart(clearOrderCart());
    setFulfillmentState(null);
    setWindowValue(null);
    setTipCentsState(0);
  }, []);

  const value = useMemo<OrderState>(() => ({
    cart,
    itemCount: orderItemCount(cart),
    subtotalCents: orderSubtotalCents(cart),
    isEmpty: isCartEmpty(cart),
    deliveryFeeCents: fulfillment?.mode === 'dispatch' ? DELIVERY_FEE_CENTS : 0,
    fulfillment,
    windowValue,
    guestName,
    tipCents,
    addLine,
    changeQuantity,
    removeLine,
    setNote,
    setFulfillment,
    setWindowValue,
    setGuestName,
    setTipCents,
    clearBag,
    resetOrder,
  }), [
    addLine,
    cart,
    changeQuantity,
    clearBag,
    fulfillment,
    guestName,
    removeLine,
    resetOrder,
    setFulfillment,
    setNote,
    setTipCents,
    tipCents,
    windowValue,
  ]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderState {
  const state = useContext(OrderContext);
  if (!state) throw new Error('useOrder must be used within OrderProvider');
  return state;
}
