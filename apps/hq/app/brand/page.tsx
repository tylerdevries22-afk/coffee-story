import { BrandConfigEditor } from '@/components/brand-config-editor';
import { currentSession, hasRole } from '@/lib/auth';

// Reads the session, so it must never be prerendered (see onboarding/page.tsx).
export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  // The nav hides this page below brand_owner, but a nav is not a gate: the
  // route was reachable by URL from any signed-in role.
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return (
      <>
        <h1>Brand config</h1>
        <p className="subtitle">Brand configuration is available to the brand owner.</p>
      </>
    );
  }
  return (
    <>
      <h1>Brand config</h1>
      <p className="subtitle">Tokens, flags, and copy — hydrated into both apps on their next launch. The preview is live.</p>
      <BrandConfigEditor />
    </>
  );
}
