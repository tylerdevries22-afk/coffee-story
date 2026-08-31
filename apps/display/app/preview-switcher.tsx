import { previewTargets } from '@platform/domain';

export function PreviewSwitcher({ currentSlug }: { currentSlug: string }) {
  const targets = previewTargets(process.env.PREVIEW_DIRECTORY, 'display', currentSlug);
  if (targets.length < 2) return null;
  return (
    <nav aria-label="Preview tenant" className="preview-switcher">
      <span>Preview tenant</span>
      {targets.map((target) => (
        <a aria-current={target.current ? 'page' : undefined} href={target.url} key={target.slug}>
          {target.label}
        </a>
      ))}
    </nav>
  );
}
