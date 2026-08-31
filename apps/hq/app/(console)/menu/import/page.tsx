import { redirect } from 'next/navigation';

import { MenuImporter } from '@/components/menu-importer';
import { currentSession, hasRole } from '@/lib/auth';

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
      <MenuImporter sample={SAMPLE} />
    </>
  );
}
