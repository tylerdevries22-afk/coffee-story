import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/** Tenant identity evidence emitted only into the static web shell. */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="platform-tenant" content={process.env.EXPO_PUBLIC_TENANT ?? ''} />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
