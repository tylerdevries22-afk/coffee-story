import type { CSSProperties } from 'react';

export type WizardIconName =
  | 'construction' | 'coffee' | 'general' | 'independent' | 'franchise'
  | 'location' | 'catalog' | 'ordering' | 'payments' | 'operations'
  | 'training' | 'printing' | 'projects' | 'wall' | 'catering'
  | 'delivery' | 'loyalty' | 'stored-value' | 'referrals' | 'drops'
  | 'integrations' | 'close' | 'complete';

const POSITION: Readonly<Record<WizardIconName, readonly [number, number]>> = {
  construction: [0, 0], coffee: [1, 0], general: [2, 0], independent: [3, 0], franchise: [4, 0],
  location: [0, 1], catalog: [1, 1], ordering: [2, 1], payments: [3, 1], operations: [4, 1],
  training: [0, 2], printing: [1, 2], projects: [2, 2], wall: [3, 2], catering: [4, 2],
  delivery: [0, 3], loyalty: [1, 3], 'stored-value': [2, 3], referrals: [3, 3], drops: [4, 3],
  integrations: [0, 4], close: [3, 4], complete: [4, 4],
};

const MODULE_ICON: Readonly<Record<string, WizardIconName>> = {
  'commerce-catalog': 'catalog', 'commerce-ordering': 'ordering', 'commerce-payments': 'payments',
  'commerce-catering': 'catering', 'commerce-delivery': 'delivery', 'growth-loyalty': 'loyalty',
  'growth-stored-value': 'stored-value', 'growth-referrals': 'referrals', 'growth-drops': 'drops',
  'workforce-operations': 'operations', 'workforce-training': 'training', 'local-printing': 'printing',
  'construction-projects': 'projects', 'device-wall': 'wall',
};

type IconStyle = CSSProperties & { '--wizard-icon-x': string; '--wizard-icon-y': string };

export function moduleWizardIcon(key: string): WizardIconName {
  return MODULE_ICON[key] ?? 'integrations';
}

export function WizardIcon({ name, className = '' }: {
  readonly name: WizardIconName;
  readonly className?: string;
}) {
  const [column, row] = POSITION[name];
  const style: IconStyle = {
    '--wizard-icon-x': `${column * 25}%`,
    '--wizard-icon-y': `${row * 25}%`,
  };
  return <span className={`wizard-icon ${className}`.trim()} style={style} aria-hidden="true" />;
}
