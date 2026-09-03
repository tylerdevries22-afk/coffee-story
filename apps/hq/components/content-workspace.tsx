'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';

import { contentCounts, type ContentWorkspaceData } from '@/lib/content-model';

import { MenuContentEditor } from './menu-content-editor';


export function ContentWorkspace({ initial }: { initial: ContentWorkspaceData }) {
  const reduceMotion = useReducedMotion();
  const counts = useMemo(() => contentCounts(initial), [initial]);
  const thumbnailCount = initial.items.filter((item) => item.imageUrl).length;
  const trainingLinks = initial.training.manifest.tracks.reduce((total, track) => (
    total + track.lessons.reduce((lessonTotal, lesson) => lessonTotal + (lesson.menuItemSlugs?.length ?? 0), 0)
  ), 0);
  return (
    <div className="content-workspace">
      <div className="content-heading-row">
        <div>
          <p className="eyebrow">Published across every ordering surface</p>
          <h1>Catalog</h1>
          <p className="subtitle">Organize offerings in one reusable hierarchy and connect their media, procedures, knowledge, skills, and training.</p>
        </div>
        <div className="content-release-state">
          <span className={`status-dot ${initial.menu.isPublished ? 'published' : 'draft'}`} />
          {initial.menu.isPublished ? 'Live' : 'Draft'} · release v{initial.menu.publishedVersion ?? '—'}
        </div>
      </div>

      <div className="content-summary-grid" aria-label="Content summary">
        <SummaryCard index={0} reduceMotion={reduceMotion} icon="menu" label="Published offerings" value={counts.listedItems} detail={`${initial.items.length} total · ${initial.categories.length} folders`} />
        <SummaryCard index={1} reduceMotion={reduceMotion} icon="image" label="Thumbnail coverage" value={`${thumbnailCount}/${initial.items.length}`} detail={`${initial.items.length - thumbnailCount} missing`} />
        <SummaryCard index={2} reduceMotion={reduceMotion} icon="book" label="Content graph" value={initial.catalogRelations.length} detail={`${initial.catalogResources.length} reusable resources`} />
        <SummaryCard index={3} reduceMotion={reduceMotion} icon="spark" label="Training links" value={trainingLinks} detail={`${counts.lessons} lessons in release`} />
      </div>
      <section aria-label="Catalog studio">
        <MenuContentEditor
          initialMenu={initial.menu}
          initialCategories={initial.categories}
          initialItems={initial.items}
          initialResources={initial.catalogResources}
          initialRelations={initial.catalogRelations}
          initialPlacements={initial.catalogPlacements}
          training={initial.training.manifest}
        />
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value, detail, index, reduceMotion }: {
  icon: IconKind;
  label: string;
  value: number | string;
  detail: string;
  index: number;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.div
      className="content-summary-card"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, delay: reduceMotion ? 0 : index * 0.045, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="content-icon-frame"><ContentIcon kind={icon} /></span>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </motion.div>
  );
}

type IconKind = 'menu' | 'book' | 'image' | 'upload' | 'plus' | 'spark';

export function ContentIcon({ kind }: { kind: IconKind }) {
  const paths: Record<IconKind, React.ReactNode> = {
    menu: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="18" r="2" /></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 4" /></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 15v5h14v-5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    spark: <><path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="content-icon">{paths[kind]}</svg>;
}
