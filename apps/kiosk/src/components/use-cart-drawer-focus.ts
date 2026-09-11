import { useCallback, useEffect, useRef } from 'react';
import { Platform, type View } from 'react-native';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function asWebElement(value: unknown): HTMLElement | null {
  if (typeof HTMLElement === 'undefined' || !(value instanceof HTMLElement)) return null;
  return value;
}

function focusWebElement(value: unknown): boolean {
  const element = asWebElement(value);
  if (!element) return false;
  element.focus();
  return true;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    element.getAttribute('aria-disabled') !== 'true'
    && element.getAttribute('aria-hidden') !== 'true'
  ));
}

/** Trap web focus inside the modal drawer and restore it after dismissal. */
export function useCartDrawerFocus(closeCart: () => void) {
  const drawerRef = useRef<View>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const dismissCart = useCallback(() => {
    const previousFocus = previousFocusRef.current;
    closeCart();
    if (Platform.OS !== 'web') return;
    window.requestAnimationFrame(() => {
      const cartButton = document.querySelector('[data-testid="kiosk-cart-button"]');
      if (focusWebElement(cartButton)) return;
      if (previousFocus?.isConnected) previousFocus.focus();
    });
  }, [closeCart]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    previousFocusRef.current = asWebElement(document.activeElement);
    const focusFrame = window.requestAnimationFrame(() => {
      const drawer = asWebElement(drawerRef.current);
      focusWebElement(drawer?.querySelector('[data-testid="kiosk-cart-close-button"]'));
    });
    const containKeyboardFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissCart();
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = asWebElement(drawerRef.current);
      if (!drawer) return;
      const focusable = focusableElements(drawer);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = asWebElement(document.activeElement);
      const leavingBack = event.shiftKey && (active === first || !active || !drawer.contains(active));
      const leavingForward = !event.shiftKey && (active === last || !active || !drawer.contains(active));
      if (!leavingBack && !leavingForward) return;
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    };
    document.addEventListener('keydown', containKeyboardFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', containKeyboardFocus);
    };
  }, [dismissCart]);

  return { dismissCart, drawerRef };
}
