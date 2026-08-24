import { KioskFlowEditor } from '@/components/kiosk-flow-editor';
import { currentSession, hasRole } from '@/lib/auth';
import { loadKioskConfig } from '@/lib/data';

// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's settings.
export const dynamic = 'force-dynamic';

/**
 * The kiosk's flow, per tenant.
 *
 * Brand-wide config that reaches every lobby screen at every location, so it
 * carries the same role gate as Brand config. Device PAIRING has a different
 * blast radius -- one tablet, one location -- and lives on /locations, which is
 * why the two are not one page: one page would have to gate its halves
 * differently.
 */
export default async function KioskPage() {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return (
      <>
        <h1>Kiosk</h1>
        <div className="notice">The kiosk flow is edited by the brand owner.</div>
      </>
    );
  }

  const { kiosk, menu, updatedAt } = await loadKioskConfig();

  return (
    <>
      <h1>Kiosk</h1>
      <p className="subtitle">
        The lobby flow for this brand — the attract screen, the first question, how a guest
        pays, and what happens after. The preview runs the same resolver a device runs, so what
        it shows is what a kiosk will draw. Note that a tile can be valid and still wrong: nothing
        here can tell that &ldquo;Pastries&rdquo; points at the Boba category.
      </p>
      <KioskFlowEditor initial={kiosk} menu={menu} updatedAt={updatedAt} />
    </>
  );
}
