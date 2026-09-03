import { BrandConfigEditor } from '@/components/brand-config-editor';
import { currentSession, hasRole } from '@/lib/auth';
import { loadBrandConfig } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function BrandPage() {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return <><h1>Brand config</h1><div className="notice">Brand settings are edited by the brand owner.</div></>;
  }
  const { config, updatedAt } = await loadBrandConfig();
  return (
    <>
      <h1>Brand config</h1>
      <p className="subtitle">Tokens, copy, and status badges — hydrated into both apps on their next launch. The preview is live. What this brand may <em>run</em> is decided by its installed modules, not here.</p>
      <BrandConfigEditor initialConfig={config} updatedAt={updatedAt} />
    </>
  );
}
