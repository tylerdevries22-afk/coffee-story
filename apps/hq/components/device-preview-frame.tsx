'use client';

import { animate, useMotionValue, useMotionValueEvent, useTransform, type MotionValue, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { EASING, duration } from '@platform/ui/motion';
import { DEFAULT_TOKENS } from '@platform/ui/tokens';

import type { AppPreviewFrame } from '@/lib/app-previews';
import { TURN_DEGREES } from '@/lib/app-wall-motion';
import { ARTWORK, chassisSize, chassisTransform, deviceRectVars, fitRotatedDevice } from '@/lib/device-fit';

type DevicePreviewFrameProps = {
  readonly frame: AppPreviewFrame;
  readonly height: number;
  readonly loading?: 'eager' | 'lazy';
  readonly orientation?: 'landscape' | 'portrait';
  readonly src: string;
  readonly title: string;
  readonly width: number;
  /** Turn progress, 0 landscape to 1 portrait; when absent the frame is static in `orientation`. */
  readonly turn?: MotionValue<number>;
  /** Receives `--device-*` each frame so chips and caption ride the silhouette. */
  readonly anchorRef?: RefObject<HTMLElement | null>;
  readonly reducedMotion?: boolean;
};

/**
 * An exact app viewport under transparent device artwork. The whole chassis
 * rotates as one about its centre and is fitted by its rotated bounding box,
 * so the artwork stays inside the tile on every frame of a turn; once the turn
 * passes halfway the screen is re-cut to portrait and counter-rotated so the
 * embedded app reads upright.
 */
export function DevicePreviewFrame({ frame, height, loading = 'lazy', orientation = 'landscape', src, title, width, turn, anchorRef, reducedMotion = false }: DevicePreviewFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const staticTurn = useMotionValue(orientation === 'portrait' ? 1 : 0);
  const progress = turn ?? staticTurn;
  const stageWidth = useMotionValue(0);
  const stageHeight = useMotionValue(0);
  const screenOpacity = useMotionValue(1);
  const [portraitScreen, setPortraitScreen] = useState(progress.get() >= .5);
  const art = ARTWORK[frame];
  const chassis = chassisSize({ width, height }, art);
  const fit = useTransform([progress, stageWidth, stageHeight], ([t, w, h]: number[]) =>
    fitRotatedDevice({ width: w ?? 0, height: h ?? 0 }, chassis, (t ?? 0) * TURN_DEGREES));
  const transform = useTransform(fit, (fitted) => chassisTransform(fitted, chassis));

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => { const rect = stage.getBoundingClientRect(); stageWidth.set(rect.width); stageHeight.set(rect.height); };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [stageHeight, stageWidth]);

  useEffect(() => { if (!turn) staticTurn.set(orientation === 'portrait' ? 1 : 0); }, [orientation, staticTurn, turn]);
  useMotionValueEvent(progress, 'change', (t) => setPortraitScreen(t >= .5));
  useMotionValueEvent(fit, 'change', (fitted) => {
    const anchor = anchorRef?.current;
    if (anchor) for (const [name, value] of Object.entries(deviceRectVars(fitted))) anchor.style.setProperty(name, value);
  });
  // The embedded page reflows when its viewport is re-cut; a brief dip hides the jump.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const seconds = duration(DEFAULT_TOKENS.motion.fast, reducedMotion) / 1000;
    if (seconds === 0) { screenOpacity.set(1); return; }
    animate(screenOpacity, [.35, 1], { duration: seconds, ease: EASING.exit });
  }, [portraitScreen, reducedMotion, screenOpacity]);

  const screenLeft = art.left * chassis.width;
  const screenTop = art.top * chassis.height;
  const screen = portraitScreen
    ? { width: height, height: width, left: screenLeft + width / 2 - height / 2, top: screenTop + height / 2 - width / 2, rotate: -TURN_DEGREES }
    : { width, height, left: screenLeft, top: screenTop, rotate: 0 };

  return (
    <div className="apps-device-stage" ref={stageRef}>
      <motion.div className={`apps-device apps-device--${frame}`} style={{ width: chassis.width, height: chassis.height, transform }}>
        <motion.div className="apps-device-viewport" data-screen={portraitScreen ? 'portrait' : 'landscape'} style={{ width: screen.width, height: screen.height, left: screen.left, top: screen.top, rotate: screen.rotate, opacity: screenOpacity }}>
          <iframe allow="fullscreen" height={screen.height} loading={loading} referrerPolicy="no-referrer" sandbox="allow-forms allow-popups allow-same-origin allow-scripts" src={src} title={title} width={screen.width} />
        </motion.div>
        {art.asset ? <img alt="" aria-hidden="true" className="apps-device-artwork" draggable={false} src={art.asset} /> : null}
      </motion.div>
    </div>
  );
}
