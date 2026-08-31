'use client';

import { useMemo, useState } from 'react';

import { layoutConstellation, type KioskFlow, type KioskMenuFacts } from '@platform/domain';

const VIEW_WIDTH = 640;
// A little taller than the physical landscape canvas so the narrow HQ card
// still gives long category labels the same breathing room as the kiosk.
const VIEW_HEIGHT = 500;

const DEMO_IMAGE_BY_LABEL: Record<string, string> = {
  'Signature Lattes': 'tiramisu-latte',
  'Coffee & Espresso': 'espresso',
  'Tea & Matcha': 'strawberry-matcha',
  Boba: 'boba-brown-sugar',
  'Sparkling Ades & Smoothies': 'ade-mango',
  Sandwiches: 'sandwich-teriyaki',
  'Sweets & Desserts': 'honeycomb-cheese-bread',
};

function imageSlugFor(label: string, configured?: string): string | null {
  if (configured) return configured;
  return DEMO_IMAGE_BY_LABEL[label] ?? null;
}

/**
 * Browser preview of the actual kiosk composition. It consumes the same
 * resolved flow and shared geometry as the native/web kiosk, including the
 * hero-first row rule, so changing a tile in HQ is visible before saving.
 */
export function KioskFlowPreview({
  flow,
  menu,
  // Only reached with no session, where there is no tenant to name. The same
  // placeholder lib/auth.ts uses, so a signed-out console says one thing.
  brandName = 'Your brand',
}: {
  flow: KioskFlow;
  menu: KioskMenuFacts;
  brandName?: string;
}) {
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const placed = useMemo(
    () => layoutConstellation(
      flow.entry.nodes.map((node) => ({ id: node.id, emphasis: node.emphasis })),
      { width: VIEW_WIDTH, height: VIEW_HEIGHT },
    ),
    [flow.entry.nodes],
  );
  const byId = new Map(flow.entry.nodes.map((node) => [node.id, node]));

  return (
    <div className="kiosk-preview" aria-label={`${brandName} kiosk preview`}>
      <div className="kiosk-preview-chrome">
        <span className="kiosk-preview-brand">{brandName}</span>
        <span className="kiosk-preview-action">Start over</span>
        <span className="kiosk-preview-spacer" />
        <span className="kiosk-preview-action">Rewards</span>
        <span className="kiosk-preview-action">Allergy &amp; nutrition</span>
      </div>
      <div className="kiosk-preview-stage">
        <strong>{flow.entry.prompt}</strong>
        <div className="kiosk-preview-canvas">
          {placed.map((circle) => {
            const node = byId.get(circle.id);
            if (!node) return null;
            const imageSlug = imageSlugFor(node.label, node.imageSlug);
            const imageKey = imageSlug ?? node.id;
            const imageSrc = imageSlug
              ? menu.imageUrls?.[imageSlug] ?? `/api/demo-media/menu/${imageSlug}`
              : null;
            const showImage = imageSrc !== null && !failedImages.has(imageKey);
            const width = `${(circle.size / VIEW_WIDTH) * 100}%`;
            const left = `${((circle.x - circle.size / 2) / VIEW_WIDTH) * 100}%`;
            const top = `${((circle.y - circle.size / 2) / VIEW_HEIGHT) * 100}%`;
            return (
              <div
                className="kiosk-preview-tile"
                key={node.id}
                style={{ left, top, width }}
                title={node.target.kind === 'category' ? node.target.categoryId : node.target.kind}
              >
                <div className="kiosk-preview-image">
                  {showImage ? (
                    // This image is the same tenant media URL used by the demo
                    // menu editor. A failed image degrades to a branded mark.
                    <img
                      src={imageSrc}
                      alt=""
                      onError={() => setFailedImages((current) => new Set(current).add(imageKey))}
                    />
                  ) : <span>{brandName.slice(0, 2).toUpperCase()}</span>}
                </div>
                <span className="kiosk-preview-label">{node.label}</span>
                {node.caption ? <small>{node.caption}</small> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="kiosk-preview-footer">
        {menu.categories.length} menu categor{menu.categories.length === 1 ? 'y' : 'ies'} · live layout
      </div>
    </div>
  );
}
