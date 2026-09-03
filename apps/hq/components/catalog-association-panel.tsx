'use client';

import type { CatalogItemAssociations } from '@/lib/catalog-insights';
import type { ContentMenuItem } from '@/lib/content-model';

import { ManagedThumbnail } from './managed-thumbnail';

type CatalogAssociationPanelProps = {
  item: ContentMenuItem;
  associations: CatalogItemAssociations;
};

export function CatalogAssociationPanel(props: CatalogAssociationPanelProps) {
  const { item, associations } = props;
  const media = item.mediaVersions.filter((version, index, versions) => (
    versions.findIndex((candidate) => candidate.url === version.url) === index
  ));
  const choiceCount = item.optionGroups.reduce((total, group) => total + group.choices.length, 0);
  return (
    <div className="catalog-association-panel">
      <header className="catalog-association-summary">
        <span><b>{media.length}</b> media revisions</span>
        <span><b>{associations.resources.length}</b> resources</span>
        <span><b>{associations.training.length}</b> lessons</span>
        <span><b>{item.optionGroups.length}</b> option groups</span>
      </header>

      <div className="catalog-association-grid">
        <AssociationSection title="Thumbnail history" detail={`${media.length} saved version${media.length === 1 ? '' : 's'}`}>
          {media.length > 0 ? (
            <div className="catalog-history-rail">
              {media.map((version) => (
                <div key={version.id} className="catalog-history-item">
                  <ManagedThumbnail url={version.url} alt={`${item.name} thumbnail saved ${formatDate(version.createdAt)}`} />
                  <time dateTime={version.createdAt}>{formatDate(version.createdAt)}</time>
                  {version.url === item.imageUrl ? <small>Current</small> : null}
                </div>
              ))}
            </div>
          ) : <EmptyAssociation>No saved thumbnail history.</EmptyAssociation>}
        </AssociationSection>

        <AssociationSection title="Recipes & resources" detail={`${associations.resources.length} graph link${associations.resources.length === 1 ? '' : 's'}`}>
          {associations.resources.length > 0 ? (
            <div className="catalog-associated-list">
              {associations.resources.map(({ relation, resource, direction }) => (
                <article key={relation.id}>
                  <span>{resource.kind.replaceAll('_', ' ')}</span>
                  <strong>{resource.title}</strong>
                  <p>{resource.summary || 'No summary has been written.'}</p>
                  <small>{direction === 'outgoing' ? relation.kind : `incoming ${relation.kind}`} · {resource.audience}</small>
                </article>
              ))}
            </div>
          ) : <EmptyAssociation>No recipes, procedures, knowledge, skills, or reusable resources linked.</EmptyAssociation>}
        </AssociationSection>

        <AssociationSection title="Training" detail={`${associations.training.length} linked lesson${associations.training.length === 1 ? '' : 's'}`}>
          {associations.training.length > 0 ? (
            <div className="catalog-associated-list">
              {associations.training.map((lesson) => (
                <article key={`${lesson.trackSlug}/${lesson.lessonSlug}`}>
                  <span>{lesson.trackTitle}</span>
                  <strong>{lesson.lessonTitle}</strong>
                  <p>{lesson.objective}</p>
                  <small>{lesson.estimatedMinutes} min · linked by offering slug</small>
                </article>
              ))}
            </div>
          ) : <EmptyAssociation>No training lesson references this offering.</EmptyAssociation>}
        </AssociationSection>

        <AssociationSection title="Ordering model" detail={`${item.sizes.length} sizes · ${choiceCount} choices`}>
          <div className="catalog-ordering-facts">
            <p><span>Audience</span><strong>{item.audience}</strong></p>
            <p><span>Availability</span><strong>{item.is86d ? '86’d' : item.isListed ? 'Listed' : 'Unlisted'}</strong></p>
            <p><span>Aliases</span><strong>{associations.aliases.join(' · ') || 'Primary path only'}</strong></p>
          </div>
          {item.sizes.length > 0 ? <div className="catalog-data-chips">{item.sizes.map((size) => (
            <span key={size.slug}>{size.label} · ${(size.priceCents / 100).toFixed(2)}</span>
          ))}</div> : <p className="catalog-base-price">Base price · ${(item.basePriceCents / 100).toFixed(2)}</p>}
          {item.optionGroups.map((group) => (
            <div className="catalog-option-summary" key={group.id}>
              <strong>{group.name}</strong>
              <small>{group.select} · {group.required ? 'required' : 'optional'} · max {group.maxChoices}</small>
              <p>{group.choices.map((choice) => `${choice.name}${choice.priceDeltaCents ? ` +$${(choice.priceDeltaCents / 100).toFixed(2)}` : ''}`).join(' · ')}</p>
            </div>
          ))}
        </AssociationSection>
      </div>
    </div>
  );
}

function AssociationSection({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <section className="catalog-association-section">
      <div><h4>{title}</h4><small>{detail}</small></div>
      {children}
    </section>
  );
}

function EmptyAssociation({ children }: { children: React.ReactNode }) {
  return <p className="catalog-association-empty">{children}</p>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown date' : date.toISOString().slice(0, 10);
}
