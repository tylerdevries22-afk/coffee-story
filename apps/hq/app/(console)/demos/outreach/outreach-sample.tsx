import type { OutreachDraft } from '@/lib/demo-factory/outreach-draft';

/**
 * The newest draft exactly as the file carries it, so the wording is
 * reviewed here once rather than discovered in a prospect's inbox.
 */
export function OutreachSample({ draft, title = 'The newest draft' }: { draft: OutreachDraft; title?: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="factory-muted">
        What the file holds for {draft.businessName}. Opening its link yourself counts as their open; preview
        the demo from the demo factory instead.
      </p>
      <dl className="outreach-draft">
        <dt>To</dt><dd>{draft.to}</dd>
        <dt>Subject</dt><dd>{draft.subject}</dd>
      </dl>
      <pre className="outreach-body">{draft.text}</pre>
    </section>
  );
}
