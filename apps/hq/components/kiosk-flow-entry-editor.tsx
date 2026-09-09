import type { KioskEntryNode, KioskMenuFacts } from '@platform/domain';

import type { KioskFlow } from './kiosk-flow-editor-types';

export function KioskFlowEntryEditor({
  flow,
  menu,
  editableNodes,
  patchEntry,
}: {
  flow: KioskFlow;
  menu: KioskMenuFacts;
  editableNodes: () => KioskEntryNode[];
  patchEntry: (next: Record<string, unknown>) => void;
}) {
  const nodes = flow.entry.nodes;
  return (
    <div className="card">
      <h2>First step</h2>
      <label className="field">
        Question
        <input value={flow.entry.prompt} onChange={(event) => patchEntry({ prompt: event.target.value })} />
      </label>
      {flow.entryDerived ? (
        <div className="notice">
          No tiles configured, so a device derives them from your menu. Editing one takes
          over the whole list — after that it stops following the menu, which is why the
          derived version is kept until you do.
        </div>
      ) : null}
      <table>
        <thead>
          <tr><th>Label</th><th>Goes to</th><th>Size</th><th /></tr>
        </thead>
        <tbody>
          {nodes.map((node, index) => (
            <tr key={node.id}>
              <td>
                <input
                  value={node.label}
                  onChange={(event) => {
                    const next = editableNodes();
                    const target = next[index];
                    if (target) next[index] = { ...target, label: event.target.value };
                    patchEntry({ nodes: next });
                  }}
                />
              </td>
              <td>
                <select
                  value={node.target.kind === 'category' ? node.target.categoryId : ''}
                  onChange={(event) => {
                    const next = editableNodes();
                    const target = next[index];
                    if (target) {
                      next[index] = {
                        ...target,
                        target: { kind: 'category', categoryId: event.target.value },
                      };
                    }
                    patchEntry({ nodes: next });
                  }}
                >
                  {menu.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.title}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  value={node.emphasis}
                  onChange={(event) => {
                    const next = editableNodes();
                    const target = next[index];
                    if (target) {
                      next[index] = {
                        ...target,
                        emphasis: event.target.value as KioskEntryNode['emphasis'],
                      };
                    }
                    patchEntry({ nodes: next });
                  }}
                >
                  <option value="hero">Hero</option>
                  <option value="standard">Standard</option>
                  <option value="minor">Minor</option>
                </select>
              </td>
              <td className="num">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => patchEntry({
                    nodes: editableNodes().filter((_, itemIndex) => itemIndex !== index),
                  })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="button secondary"
        type="button"
        onClick={() => {
          const first = menu.categories[0];
          if (!first) return;
          patchEntry({
            nodes: [...editableNodes(), {
              id: `tile-${editableNodes().length + 1}`,
              label: first.title,
              emphasis: 'standard',
              target: { kind: 'category', categoryId: first.id },
            }],
          });
        }}
      >
        Add a tile
      </button>
    </div>
  );
}
