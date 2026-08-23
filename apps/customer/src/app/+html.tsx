import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { BUSINESS } from '@/data/business';
import { TENANT } from '@/tenant';

/**
 * HTML shell for the web build only. Native is unaffected.
 *
 * This is what turns the web export into something that behaves like an app
 * rather than a web page: installable to the home screen, launched without
 * browser chrome, drawn under the notch, and immune to the pinch-zoom and
 * rubber-band scrolling that immediately break the illusion of a native UI.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/*
          `viewport-fit=cover` lets the layout reach under the notch and home
          indicator, which is what makes safe-area insets meaningful.
          `user-scalable=no` is normally an accessibility smell, but this is a
          fixed-layout app shell where pinch-zoom leaves the UI stranded
          mid-gesture rather than helping anyone read it.
        */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no"
        />

        <title>{BUSINESS.name}</title>
        <meta name="description" content={DESCRIPTION} />

        {/* Installable: launches standalone from the home screen. */}
        {/* Served from `public/`, which Expo copies to the web root. The
            link used to point at `/demo/manifest.webmanifest`, which does not
            exist anywhere in the tree -- so it 404'd and `InstallPrompt` was
            offering an install the browser could never complete. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content={THEME_COLOR} />

        {/* iOS has never read the manifest for these; it needs its own tags. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={BUSINESS.name} />
        {/* 180px is exactly what iOS asks for; handing it the 512 just makes
            Safari downscale a file 4x larger on every add-to-home-screen. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />

        {/* The brand's own site is the thing search should find; this build
            is the app. */}
        <meta name="robots" content="noindex" />

        {/* Expo's reset: makes body scrolling behave like a native ScrollView. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: shellCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * The head used to name Coffee Story four times over -- title, description,
 * home-screen title, theme colour -- so a `TENANT=<other>` web build shipped
 * 28 pages titled "Coffee Story". These read the tenant instead. `public/
 * manifest.webmanifest` is a static file Metro cannot template, so `pnpm
 * onboard --apply` writes it from the same brand.json.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A token, or the bundled default when the tenant's value is malformed --
 * the same field-by-field fallback packages/ui applies on device. */
function token(name: 'primary' | 'surface', fallback: string): string {
  const value = TENANT.tokens?.[name];
  return typeof value === 'string' && HEX.test(value) ? value : fallback;
}

const THEME_COLOR = token('primary', '#241710');
// City and region only, matching the manifest onboarding writes: "in Aurora,
// CO" reads as a place, "in Aurora, CO 80014" reads as a mailing label.
const WHERE = [TENANT.location.address.city, TENANT.location.address.region].filter(Boolean).join(', ');
const DESCRIPTION = `Order ahead, send a gift card, and earn ${TENANT.copy.pointsName ?? 'points'}`
  + ` at ${BUSINESS.name}${WHERE ? ` in ${WHERE}` : ''}.`;

/**
 * `overscroll-behavior: none` kills the rubber-band bounce that reveals the
 * browser underneath, and the tap-highlight reset removes the grey flash
 * Android draws on every press.
 */
function shellCss(): string {
  return `
  html, body, #root {
    height: 100%;
    background-color: ${token('surface', '#FFFDF8')};
  }
  body {
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
  }
  * { -webkit-touch-callout: none; }
`;
}
