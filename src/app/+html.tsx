import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

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

        <title>Coffee Story</title>
        <meta
          name="description"
          content="Order ahead, send a gift card, and earn Beans at Coffee Story in Aurora, Colorado."
        />

        {/* Installable: launches standalone from the home screen. */}
        {/* Served from `public/`, which Expo copies to the web root. The
            link used to point at `/demo/manifest.webmanifest`, which does not
            exist anywhere in the tree -- so it 404'd and `InstallPrompt` was
            offering an install the browser could never complete. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* colors.brand900. This was #46304E, the plum of the business this
            app was rebranded from. */}
        <meta name="theme-color" content="#241710" />

        {/* iOS has never read the manifest for these; it needs its own tags. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Coffee Story" />
        {/* 180px is exactly what iOS asks for; handing it the 512 just makes
            Safari downscale a file 4x larger on every add-to-home-screen. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png" />

        {/* coffeestoryco.com is the shop's site; this build is the app. */}
        <meta name="robots" content="noindex" />

        {/* Expo's reset: makes body scrolling behave like a native ScrollView. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

/**
 * `overscroll-behavior: none` kills the rubber-band bounce that reveals the
 * browser underneath, and the tap-highlight reset removes the grey flash
 * Android draws on every press.
 */
const SHELL_CSS = `
  html, body, #root {
    height: 100%;
    /* colors.surface. This was #FFFCFE, the old plum-tinted white. */
    background-color: #FFFDF8;
  }
  body {
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
  }
  * { -webkit-touch-callout: none; }
`;
