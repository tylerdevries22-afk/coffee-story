import type { ReactNode } from 'react';

import type { BusinessStepField } from '@/lib/organization-business-step';

type FieldLabelProps = {
  readonly label: string;
  readonly optional?: boolean;
  readonly className?: string;
  /** Still holding Google's value: the cue for what the operator has not yet reviewed by hand. */
  readonly fromGoogle: boolean;
  readonly children: ReactNode;
};

/** The badge beside anything a Google listing filled in. */
export function FromGoogle() {
  return <small className="from-google-badge">From Google</small>;
}

/**
 * A wizard field's label. The badge sits inside the label, so a screen reader
 * hears "From Google" as part of the field's name for exactly as long as a
 * sighted operator sees it.
 */
export function FieldLabel({ label, optional = false, className, fromGoogle, children }: FieldLabelProps) {
  const classes = [className, fromGoogle ? 'from-google' : null].filter(Boolean).join(' ');
  return (
    <label className={classes || undefined}>
      {label}{optional ? <span> (optional)</span> : null}{fromGoogle ? <FromGoogle /> : null}
      {children}
    </label>
  );
}

/** Points a field at the wizard's one error line while the step check blames it. */
export function invalidProps(field: BusinessStepField, invalidField: BusinessStepField | null) {
  return invalidField === field
    ? { 'aria-invalid': true, 'aria-errormessage': 'organization-step-error' } as const
    : {};
}
