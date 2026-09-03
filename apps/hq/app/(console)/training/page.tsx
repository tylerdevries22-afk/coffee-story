import { TrainingContentEditor } from '@/components/training-content-editor';
import { currentSession, hasRole } from '@/lib/auth';
import { loadContentWorkspace } from '@/lib/content-data';

export const dynamic = 'force-dynamic';

export default async function TrainingPage() {
  const session = await currentSession();
  if (!session || !hasRole(session, 'location_manager')) {
    return (
      <>
        <h1>Training</h1>
        <div className="notice">Training is available to tenant managers and above.</div>
      </>
    );
  }
  const canEdit = hasRole(session, 'brand_owner');
  const data = await loadContentWorkspace({ includeDraft: canEdit, includeAnswers: canEdit });
  return (
    <div className="content-workspace">
      <div className="content-heading-row">
        <div>
          <p className="eyebrow">Franchise curriculum system</p>
          <h1>Training</h1>
          <p className="subtitle">Five shared tracks, tenant overlays, and verified lessons delivered to every operator.</p>
        </div>
        <div className="content-release-state" aria-label="Current training release">
          <span className={`status-dot ${data.training.status}`} aria-hidden="true" />
          {data.training.status === 'empty' ? 'No published release' : `v${data.training.version} ${data.training.status}`}
        </div>
      </div>
      <div className="content-summary-grid" aria-label="Training summary">
        <div className="content-summary-card"><span className="content-icon-frame"><span aria-hidden="true">5</span></span><div><span>Core tracks</span><strong>5</strong><small>Knowledge through Operations</small></div></div>
        <div className="content-summary-card"><span className="content-icon-frame"><span aria-hidden="true">{data.training.manifest.tracks.length}</span></span><div><span>Tracks</span><strong>{data.training.manifest.tracks.length}</strong><small>Core plus tenant</small></div></div>
        <div className="content-summary-card"><span className="content-icon-frame"><span aria-hidden="true">{data.training.manifest.tracks.reduce((count, track) => count + track.lessons.length, 0)}</span></span><div><span>Lessons</span><strong>{data.training.manifest.tracks.reduce((count, track) => count + track.lessons.length, 0)}</strong><small>Versioned with release</small></div></div>
      </div>
      <TrainingContentEditor
        initialRelease={data.training}
        initialProfile={data.trainingProfile}
        automationRun={data.automationRun}
        trainingMediaVersions={data.trainingMediaVersions}
        readOnly={!canEdit}
      />
    </div>
  );
}
