import { ContentWorkspace } from '@/components/content-workspace';
import { currentSession, hasRole } from '@/lib/auth';
import { loadContentWorkspace } from '@/lib/content-data';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return (
      <>
        <h1>Content</h1>
        <div className="notice">Menu content editing is managed by the brand owner. Training has its own section.</div>
      </>
    );
  }
  const data = await loadContentWorkspace();
  return <ContentWorkspace initial={data} />;
}
