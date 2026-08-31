import Link from 'next/link';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';

import { importMenuAction } from '../actions';

export const dynamic = 'force-dynamic';

const SAMPLE = `slug,name,category,description,base_price_cents,sizes
item-one,Item One,Category A,Example description,500,S:500|L:650
item-two,Item Two,Category B,Another example,750,`;

type ImportMenuPageProps = { searchParams: Promise<{ error?: string }> };

export default async function ImportMenuPage({ searchParams }: ImportMenuPageProps) {
  const [session, params] = await Promise.all([currentSession(), searchParams]);
  if (!session || !hasRole(session, 'brand_owner')) redirect('/menu');

  return (
    <>
      <h1>Import menu</h1>
      <p className="subtitle">
        Paste a CSV with the header <code>slug,name,category,description,base_price_cents,sizes</code>.
        Prices are integer cents; sizes are optional as <code>12:350|16:425</code>. Re-importing is
        safe — rows update in place.
      </p>
      {params.error ? <div className="notice danger" role="status">{params.error}</div> : null}
      <div className="card">
        <form action={importMenuAction} className="location-form">
          <label className="field">
            Menu CSV
            <textarea name="csv" rows={12} required defaultValue={SAMPLE} spellCheck={false} className="menu-csv-input" />
          </label>
          <div className="location-form-actions">
            <Link href="/menu" className="button secondary">Cancel</Link>
            <button type="submit" className="button">Import menu</button>
          </div>
        </form>
      </div>
    </>
  );
}
