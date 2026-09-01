import { redirect } from 'next/navigation';

type WallPageProps = {
  searchParams: Promise<{ location?: string }>;
};

export default async function LegacyWallPage({ searchParams }: WallPageProps) {
  const { location } = await searchParams;
  const query = location ? `?location=${encodeURIComponent(location)}` : '';
  redirect(`/apps/display${query}`);
}
