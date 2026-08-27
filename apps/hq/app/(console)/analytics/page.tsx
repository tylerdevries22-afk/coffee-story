import { AnalyticsRoute } from '@/components/analytics-route';

// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  return <AnalyticsRoute view="overview" />;
}
