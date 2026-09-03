import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { hqTheme } from '@/lib/theme';

import './globals.css';
import './styles/console-core.css';
import './styles/console-navigation.css';
import './styles/console-command.css';
import './styles/console-responsive.css';
import './styles/dashboard.css';
import './styles/dashboard-responsive.css';
import './styles/apps.css';
import './styles/apps-wall.css';
import './styles/apps-wall-chips.css';
import './styles/apps-preview-table.css';
import './styles/device-wall.css';
import './styles/catalog.css';
import './styles/storage.css';
import './styles/analytics.css';
import './styles/analytics-responsive.css';
import './styles/status.css';

export const metadata: Metadata = {
  title: 'HQ',
  description: 'Multi-tenant ordering platform console',
};

/**
 * The document only. Every surface this app serves shares html/body and the
 * token sheet; what wraps the content is the route group's business, because
 * the console and the pickup display are not the same kind of screen.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={hqTheme(null) as CSSProperties}>
        <TooltipProvider delayDuration={180}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
