'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { AppPreviewFrame } from '@/lib/app-previews';

type DevicePreviewFrameProps = {
  readonly frame: AppPreviewFrame;
  readonly height: number;
  readonly loading?: 'eager' | 'lazy';
  readonly orientation?: 'landscape' | 'portrait';
  readonly src: string;
  readonly title: string;
  readonly width: number;
};

type Artwork = {
  readonly asset?: string;
  readonly left: number;
  readonly screenHeight: number;
  readonly screenWidth: number;
  readonly top: number;
};

const ARTWORK: Readonly<Record<AppPreviewFrame, Artwork>> = {
  computer: { asset: '/device-frames/imac.png', left: .040694519805, top: .050573162508, screenWidth: .918610960391, screenHeight: .64194200944 },
  phone: { asset: '/device-frames/iphone-x.png', left: .068870523416, top: .031855955679, screenWidth: .862258953168, screenHeight: .936288088643 },
  tablet: { asset: '/device-frames/ipad-pro-landscape.png', left: .070440251572, top: .054054054054, screenWidth: .859119496855, screenHeight: .892327811683 },
  tv: { left: .02, top: .035, screenWidth: .96, screenHeight: .93 },
};

type FittedDevice = { readonly left: number; readonly scale: number; readonly top: number };

function fitDevice(bounds: DOMRectReadOnly, width: number, height: number, art: Artwork): FittedDevice {
  const outerWidth = width / art.screenWidth;
  const outerHeight = height / art.screenHeight;
  const scale = Math.min(bounds.width / outerWidth, bounds.height / outerHeight);
  return {
    left: Math.max(0, (bounds.width - outerWidth * scale) / 2),
    scale: Number.isFinite(scale) ? Math.max(.01, scale) : 1,
    top: Math.max(0, (bounds.height - outerHeight * scale) / 2),
  };
}

/** Displays an exact app viewport under the matching transparent device artwork. */
export function DevicePreviewFrame({ frame, height, loading = 'lazy', orientation = 'landscape', src, title, width }: DevicePreviewFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<FittedDevice>({ left: 0, scale: 1, top: 0 });
  const reducedMotion = useReducedMotion();
  const portrait = orientation === 'portrait';
  const baseArt = ARTWORK[frame];
  const art = useMemo(() => portrait
    ? { ...baseArt, left: 1 - baseArt.top - baseArt.screenHeight, top: baseArt.left, screenWidth: baseArt.screenHeight, screenHeight: baseArt.screenWidth }
    : baseArt, [baseArt, portrait]);
  const viewportWidth = portrait ? height : width;
  const viewportHeight = portrait ? width : height;
  const outerWidth = viewportWidth / art.screenWidth;
  const outerHeight = viewportHeight / art.screenHeight;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const resize = () => setFitted(fitDevice(stage.getBoundingClientRect(), viewportWidth, viewportHeight, art));
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, [art, viewportHeight, viewportWidth]);

  return (
    <div className="apps-device-stage" ref={stageRef}>
      <motion.div
        animate={{ scale: fitted.scale, x: fitted.left, y: fitted.top }}
        className={`apps-device apps-device--${frame}${portrait ? ' apps-device--portrait' : ''}`}
        initial={false}
        layout="position"
        style={{ height: outerHeight, width: outerWidth }}
        transition={reducedMotion ? { duration: 0 } : { damping: 34, mass: .72, stiffness: 460, type: 'spring' }}
      >
        <div
          className="apps-device-viewport"
          style={{ height: viewportHeight, left: `${art.left * 100}%`, top: `${art.top * 100}%`, width: viewportWidth }}
        >
          <iframe allow="fullscreen" height={viewportHeight} loading={loading} referrerPolicy="no-referrer" sandbox="allow-forms allow-popups allow-same-origin allow-scripts" src={src} title={title} width={viewportWidth} />
        </div>
        {baseArt.asset ? <img alt="" aria-hidden="true" className="apps-device-artwork" draggable={false} src={baseArt.asset} style={portrait ? { height: outerWidth, transform: `translateX(${outerWidth}px) rotate(90deg)`, transformOrigin: 'top left', width: outerHeight } : undefined} /> : null}
      </motion.div>
    </div>
  );
}
