import Link from 'next/link';

import type { AppPreview } from '@/lib/app-previews';
import type { DeviceWallView } from '@/lib/device-wall-data';

import { DevicePreviewFrame } from './device-preview-frame';
import { Icon } from './icon';
import { DeviceWallModule } from './device-wall/device-wall-module';

type PreviewProps = { readonly preview: AppPreview };

const SOURCE_LABEL: Readonly<Record<AppPreview['source'], string>> = {
  configured: 'Hosted preview',
  local: 'Local preview',
  unavailable: 'Preview not configured',
};

function PreviewFrame({ preview }: PreviewProps) {
  if (!preview.url) {
    return (
      <div className="apps-preview-unavailable" role="status">
        <Icon name="settings" size={20} />
        <p>Set <code>{preview.environmentKey}</code> to show this hosted app here.</p>
      </div>
    );
  }
  return (
    <DevicePreviewFrame
      frame={preview.frame}
      height={preview.viewport.height}
      src={preview.url}
      title={`${preview.label} app preview`}
      width={preview.viewport.width}
    />
  );
}

/** The Apps root: a navigable overview of every operational application. */
export function AppsPreviewWall({ deviceWall, previews }: { readonly deviceWall: DeviceWallView; readonly previews: readonly AppPreview[] }) {
  return (
    <div className="apps-page apps-wall-page">
      <DeviceWallModule previews={previews} view={deviceWall} />
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
        <PreviewFrame preview={preview} />
      </section>
    </div>
  );
}
