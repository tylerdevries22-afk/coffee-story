import Link from 'next/link';

import type { AppPreview } from '@/lib/app-previews';

import { Icon } from './icon';

type PreviewProps = { readonly preview: AppPreview };

const SOURCE_LABEL: Readonly<Record<AppPreview['source'], string>> = {
  configured: 'Hosted preview',
  local: 'Local preview',
  unavailable: 'Preview not configured',
};

function PreviewFrame({ preview, eager = false }: PreviewProps & { readonly eager?: boolean }) {
  if (!preview.url) {
    return (
      <div className="apps-preview-unavailable" role="status">
        <Icon name="settings" size={20} />
        <p>Set <code>{preview.environmentKey}</code> to show this hosted app here.</p>
      </div>
    );
  }
  return (
    <iframe
      className="apps-preview-iframe"
      src={preview.url}
      title={`${preview.label} app preview`}
      loading={eager ? 'eager' : 'lazy'}
      allow="fullscreen"
      referrerPolicy="no-referrer"
      sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
    />
  );
}

function PreviewCard({ preview }: PreviewProps) {
  return (
    <li className={`apps-preview-card apps-preview-card--${preview.frame}`}>
      <article>
        <header className="apps-preview-card-header">
          <span className="apps-preview-icon" aria-hidden="true"><Icon name={preview.icon} size={19} /></span>
          <span className="apps-preview-card-copy">
            <strong>{preview.label}</strong>
            <small>{preview.device} · {SOURCE_LABEL[preview.source]}</small>
          </span>
          <Link className="apps-preview-open" href={preview.href} aria-label={`Open ${preview.label} app`}>
            <Icon name="external" size={16} />
          </Link>
        </header>
        <p className="apps-preview-description">{preview.description}</p>
        <div className="apps-preview-stage"><PreviewFrame preview={preview} /></div>
        <Link className="apps-preview-link" href={preview.href}>Open {preview.label}</Link>
      </article>
    </li>
  );
}

/** The Apps root: a navigable overview of every operational application. */
export function AppsPreviewWall({ previews }: { readonly previews: readonly AppPreview[] }) {
  return (
    <div className="apps-page">
      <header className="apps-page-header">
        <div>
          <p className="apps-eyebrow">Apps</p>
          <h1>Wall</h1>
          <p>Open a surface below, or use the Apps navigation to switch directly between customer, operator, kiosk, and pickup queue workflows.</p>
        </div>
      </header>
      <ol className="apps-preview-grid" aria-label="Application previews">
        {previews.map((preview) => <PreviewCard key={preview.key} preview={preview} />)}
      </ol>
    </div>
  );
}

/** A focused application page with one large preview and a reliable direct link. */
export function AppSurfacePreview({ preview }: PreviewProps) {
  return (
    <div className={`apps-page apps-surface apps-surface--${preview.frame}`}>
      <nav className="apps-breadcrumb" aria-label="Breadcrumb"><Link href="/apps">Apps wall</Link><span aria-hidden="true">/</span><span>{preview.label}</span></nav>
      <header className="apps-page-header apps-surface-header">
        <div>
          <p className="apps-eyebrow">{preview.device} · {SOURCE_LABEL[preview.source]}</p>
          <h1>{preview.label}</h1>
          <p>{preview.description}</p>
        </div>
        {preview.url ? <a className="apps-external-link" href={preview.url} target="_blank" rel="noopener noreferrer">Open in new tab <Icon name="external" size={16} /></a> : null}
      </header>
      <section className="apps-surface-frame" aria-label={`${preview.label} application`}>
        <PreviewFrame preview={preview} eager />
      </section>
    </div>
  );
}
