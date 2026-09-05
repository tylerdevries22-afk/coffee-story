import { ConsoleState } from '@/components/console-state';
import { KnowledgeWorkspace } from '@/components/knowledge-workspace';
import { loadKnowledgeWorkspace } from '@/lib/knowledge-data';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const workspace = await loadKnowledgeWorkspace();
  if (!workspace.enabled) {
    return <ConsoleState kind="permission" title="Knowledge is not installed"
      description="Install the workforce training module for this organization to manage controlled field documents." />;
  }
  return <KnowledgeWorkspace initial={workspace} />;
}
