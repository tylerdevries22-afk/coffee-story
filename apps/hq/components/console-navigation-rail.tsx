'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ConsoleContextPanel } from './console-context-panel';
import type { ConsoleRailProps } from './console-shell-types';

function keepFocusInDrawer(event: ReactKeyboardEvent<HTMLElement>, isOpen: boolean) {
  if (!isOpen || event.key !== 'Tab') return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input'),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ConsoleNavigationRail(props: ConsoleRailProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      id="console-navigation"
      className={`hq-navigation${props.isOpen ? ' open' : ''}`}
      aria-label="Console navigation"
      aria-hidden={props.isHidden || undefined}
      inert={props.isHidden || undefined}
      initial={false}
      animate={{ x: props.mobile && !props.isOpen ? '-101%' : '0%' }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0, 0, 1] }}
      onKeyDown={(event) => keepFocusInDrawer(event, props.isOpen)}
    >
      <ConsoleContextPanel {...props} />
    </motion.div>
  );
}
