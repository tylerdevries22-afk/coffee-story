import { ContentWorkspace } from '@/components/content-workspace';
import { currentSession, hasRole } from '@/lib/auth';
import { loadContentWorkspace } from '@/lib/content-data';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return (
      <>
        <h1>Catalog</h1>
        <div className="notice">Catalog editing is managed by the brand owner.</div>
      </>
    );
  }
  return <ContentWorkspace initial={await loadContentWorkspace()} />;
}
