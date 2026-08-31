import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';

import { createOrganizationAction } from '../actions';

export const dynamic = 'force-dynamic';

type NewOrgPageProps = { searchParams: Promise<{ error?: string }> };

export default async function NewOrganizationPage({ searchParams }: NewOrgPageProps) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  // Adding a tenant to the platform is a platform-admin action; RLS agrees.
  if (!session || !hasRole(session, 'platform_admin')) redirect('/');

  return (
    <>
      <h1>Create organization</h1>
      <p className="subtitle">
        Starts blank — a neutral theme and no copy until you brand it. You’ll add
        the first location next, then connect Square and pair devices.
      </p>
      {params.error ? <div className="notice danger" role="status">{params.error}</div> : null}
      <div className="card">
        <form action={createOrganizationAction} className="location-form">
          <label className="field">
            Organization name
            <input name="name" required maxLength={120} placeholder="e.g. Harbor Bakery" autoFocus />
          </label>
          <p className="muted">
            Any industry — the handle is derived from the name, and the theme,
            menu, and copy stay empty until you set them.
          </p>
          <div className="location-form-actions">
            <Link href="/" className="button secondary">Cancel</Link>
            <button type="submit" className="button">Create &amp; add first location</button>
          </div>
        </form>
      </div>
    </>
  );
}
