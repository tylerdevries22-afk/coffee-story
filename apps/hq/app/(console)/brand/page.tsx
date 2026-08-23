import { BrandConfigEditor } from '@/components/brand-config-editor';

export default function BrandPage() {
  return (
    <>
      <h1>Brand config</h1>
      <p className="subtitle">Tokens, flags, and copy — hydrated into both apps on their next launch. The preview is live.</p>
      <BrandConfigEditor />
    </>
  );
}
