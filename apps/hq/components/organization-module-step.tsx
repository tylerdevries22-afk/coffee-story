'use client';

import {
  MODULE_TIERS,
  moduleOptionsForIndustry,
  requiredBySelection,
  resolvedModuleSelection,
} from '@/lib/organization-onboarding';
import type { IndustryKey } from '@/lib/org-input';

import { moduleWizardIcon, WizardIcon } from './wizard-icon';

type ModuleStepProps = {
  readonly industry: IndustryKey | null;
  readonly selected: readonly string[];
  readonly onChange: (selected: string[]) => void;
};

export function OrganizationModuleStep({ industry, selected, onChange }: ModuleStepProps) {
  const currentIndustry = industry ?? 'general';
  const options = moduleOptionsForIndustry(currentIndustry);
  const toggle = (key: string) => onChange(resolvedModuleSelection(currentIndustry,
    selected.includes(key) ? selected.filter((candidate) => candidate !== key) : [...selected, key]));
  return (
    <section className="onboarding-step" data-wizard-step="2" aria-labelledby="modules-question">
      <div className="onboarding-question split">
        <div><p className="onboarding-kicker">Product modules</p><h2 id="modules-question" tabIndex={-1}>Choose what this organization runs</h2>
          <p>Eligible modules are organized by tier. Dependencies are added automatically.</p></div>
        <strong className="selection-count">{selected.length} selected</strong>
      </div>
      <div className="module-groups">
        {MODULE_TIERS.map((tier) => <fieldset key={tier.key} className="module-group">
          <legend>{tier.label}</legend>
          <p>{tier.summary}</p>
          <div className="module-grid">
            {options.filter((option) => option.tier === tier.key).map((option) => {
              const requiredBy = requiredBySelection(currentIndustry, selected, option.key);
              return <label key={option.key} className={`module-option${selected.includes(option.key) ? ' selected' : ''}`}>
                <input type="checkbox" name="moduleKeys" value={option.key}
                  checked={selected.includes(option.key)} disabled={requiredBy.length > 0}
                  onChange={() => toggle(option.key)} />
                <WizardIcon name={moduleWizardIcon(option.key)} />
                <span><strong>{option.label}</strong><small>{option.summary}</small>
                  <em>{requiredBy.length ? `Required by ${requiredBy.join(', ')}` : option.surfaces.join(' · ')}</em></span>
                <span className="module-control" aria-hidden="true">{selected.includes(option.key) ? '✓' : '+'}</span>
              </label>
            })}
          </div>
        </fieldset>)}
      </div>
    </section>
  );
}
