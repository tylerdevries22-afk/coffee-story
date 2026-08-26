'use client';

import {
  slugFromLabel,
  type ContentMenuSize,
  type ContentOptionGroup,
} from '@/lib/content-model';

type Props = {
  sizes: ContentMenuSize[];
  optionGroups: ContentOptionGroup[];
  onSizesChange: (sizes: ContentMenuSize[]) => void;
  onOptionGroupsChange: (groups: ContentOptionGroup[]) => void;
};

export function MenuOrderingEditor({ sizes, optionGroups, onSizesChange, onOptionGroupsChange }: Props) {
  return (
    <div className="menu-ordering-editor">
      <EditorHeading
        eyebrow="Sizes"
        title="Customer prices"
        detail="Leave empty for one item at the base price."
        onAdd={() => onSizesChange([...sizes, { slug: `size-${sizes.length + 1}`, label: 'Size', priceCents: 0 }])}
      />
      {sizes.map((size, index) => (
        <SizeRow
          key={`${index}-${size.slug}`}
          size={size}
          onChange={(next) => onSizesChange(replaceAt(sizes, index, next))}
          onRemove={() => onSizesChange(sizes.filter((_, current) => current !== index))}
        />
      ))}
      <EditorHeading
        eyebrow="Modifiers"
        title="Customer choices"
        detail="Build required selections, add-ons, and conditional follow-up choices."
        onAdd={() => onOptionGroupsChange([...optionGroups, emptyGroup(optionGroups.length + 1)])}
      />
      {optionGroups.map((group, index) => (
        <OptionGroupCard
          key={`${index}-${group.id}`}
          group={group}
          availableParents={optionGroups.slice(0, index)}
          onChange={(next) => onOptionGroupsChange(replaceAt(optionGroups, index, next))}
          onRemove={() => onOptionGroupsChange(optionGroups.filter((_, current) => current !== index))}
        />
      ))}
    </div>
  );
}

function EditorHeading({ eyebrow, title, detail, onAdd }: { eyebrow: string; title: string; detail: string; onAdd: () => void }) {
  return (
    <div className="menu-ordering-heading">
      <div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3><small>{detail}</small></div>
      <button type="button" className="content-text-button" onClick={onAdd}>Add {eyebrow.toLowerCase().replace(/s$/, '')}</button>
    </div>
  );
}

function SizeRow({ size, onChange, onRemove }: { size: ContentMenuSize; onChange: (size: ContentMenuSize) => void; onRemove: () => void }) {
  return (
    <div className="menu-size-row">
      <label className="field">Label<input value={size.label} onChange={(event) => onChange({ ...size, label: event.target.value })} /></label>
      <label className="field">Portable key<input value={size.slug} onChange={(event) => onChange({ ...size, slug: slugFromLabel(event.target.value) })} /></label>
      <label className="field">Price<input type="number" min="0" step="0.01" value={(size.priceCents / 100).toFixed(2)} onChange={(event) => onChange({ ...size, priceCents: centsOf(event.target.value) })} /></label>
      <button type="button" className="icon-action danger" aria-label={`Remove ${size.label || 'size'}`} onClick={onRemove}>×</button>
    </div>
  );
}

function OptionGroupCard({ group, availableParents, onChange, onRemove }: {
  group: ContentOptionGroup;
  availableParents: ContentOptionGroup[];
  onChange: (group: ContentOptionGroup) => void;
  onRemove: () => void;
}) {
  const patch = (next: Partial<ContentOptionGroup>) => onChange({ ...group, ...next });
  const parent = availableParents.find((candidate) => candidate.id === group.dependsOn?.groupId);
  return (
    <div className="menu-option-card">
      <div className="menu-option-grid">
        <label className="field">Group name<input value={group.name} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label className="field">Portable key<input value={group.id} onChange={(event) => patch({ id: slugFromLabel(event.target.value) })} /></label>
        <label className="field">Selection<select value={group.select} onChange={(event) => {
          const select = event.target.value as ContentOptionGroup['select'];
          patch({ select, maxChoices: select === 'single' ? 1 : Math.max(1, group.maxChoices) });
        }}><option value="single">Choose one</option><option value="multi">Choose several</option></select></label>
        <label className="field">Maximum<input type="number" min="1" max="30" disabled={group.select === 'single'} value={group.maxChoices} onChange={(event) => patch({ maxChoices: Number(event.target.value) })} /></label>
      </div>
      <div className="content-check-row">
        <label><input type="checkbox" checked={group.required} onChange={(event) => patch({ required: event.target.checked })} /> Required before adding to bag</label>
      </div>
      <div className="menu-condition-row">
        <label className="field">Show after<select value={group.dependsOn?.groupId ?? ''} onChange={(event) => patch({ dependsOn: event.target.value ? { groupId: event.target.value, choiceIds: [] } : undefined })}>
          <option value="">Always visible</option>
          {availableParents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select></label>
        {parent ? <label className="field">When choices match<select multiple value={group.dependsOn?.choiceIds ?? []} onChange={(event) => patch({ dependsOn: { groupId: parent.id, choiceIds: Array.from(event.target.selectedOptions, (option) => option.value) } })}>
          {parent.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select></label> : null}
      </div>
      <div className="menu-choice-list">
        {group.choices.map((choice, index) => <ChoiceRow key={`${index}-${choice.id}`} choice={choice} onChange={(next) => patch({ choices: replaceAt(group.choices, index, next) })} onRemove={() => patch({ choices: group.choices.filter((_, current) => current !== index) })} />)}
      </div>
      <div className="menu-option-footer">
        <button type="button" className="content-text-button" onClick={() => patch({ choices: [...group.choices, emptyChoice(group.choices.length + 1)] })}>Add choice</button>
        <button type="button" className="content-danger-button" onClick={onRemove}>Remove option group</button>
      </div>
    </div>
  );
}

function ChoiceRow({ choice, onChange, onRemove }: { choice: ContentOptionGroup['choices'][number]; onChange: (choice: ContentOptionGroup['choices'][number]) => void; onRemove: () => void }) {
  return (
    <div className="menu-choice-row">
      <label className="field">Choice<input value={choice.name} onChange={(event) => onChange({ ...choice, name: event.target.value })} /></label>
      <label className="field">Portable key<input value={choice.id} onChange={(event) => onChange({ ...choice, id: slugFromLabel(event.target.value) })} /></label>
      <label className="field">Added price<input type="number" min="0" step="0.01" value={(choice.priceDeltaCents / 100).toFixed(2)} onChange={(event) => onChange({ ...choice, priceDeltaCents: centsOf(event.target.value) })} /></label>
      <button type="button" className="icon-action danger" aria-label={`Remove ${choice.name || 'choice'}`} onClick={onRemove}>×</button>
    </div>
  );
}

function emptyGroup(number: number): ContentOptionGroup {
  return { id: `option-${number}`, name: `Option ${number}`, select: 'single', required: false, maxChoices: 1, choices: [emptyChoice(1)] };
}

function emptyChoice(number: number): ContentOptionGroup['choices'][number] {
  return { id: `choice-${number}`, name: `Choice ${number}`, priceDeltaCents: 0 };
}

function centsOf(value: string): number {
  return Math.round(Number(value) * 100);
}

function replaceAt<T>(values: T[], index: number, value: T): T[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current);
}
