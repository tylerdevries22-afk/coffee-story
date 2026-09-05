'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';

import { createOrganizationAction } from '@/app/(console)/organizations/actions';
import type { ConnectorCard } from '@/lib/integration-cards';
import { businessStepOf, type BusinessStepIssue } from '@/lib/organization-business-step';
import { ORGANIZATION_IDLE } from '@/lib/organization-action-state';
import { INDUSTRY_OPTIONS } from '@/lib/organization-onboarding';
import type { IndustryKey, OrganizationKind } from '@/lib/org-input';

import { McpStore } from './mcp-store';
import { OrganizationModuleStep } from './organization-module-step';
import { OrganizationOnboardingDetails } from './organization-onboarding-details';
import { WizardIcon } from './wizard-icon';

type WizardProps = {
  readonly idempotencyKey: string;
  readonly ownerEmail: string;
  readonly connectorCards: readonly ConnectorCard[];
};

const STEPS = ['Business', 'Organization', 'Modules', 'MCP Store', 'Details'] as const;

export function OrganizationOnboardingWizard(props: WizardProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [state, submit, pending] = useActionState(createOrganizationAction, ORGANIZATION_IDLE);
  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [kind, setKind] = useState<OrganizationKind>('independent');
  const [industry, setIndustry] = useState<IndustryKey | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [stepIssue, setStepIssue] = useState<BusinessStepIssue | null>(null);
  const choice = INDUSTRY_OPTIONS.find((option) => option.key === industry);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() => formRef.current
      ?.querySelector<HTMLElement>(`[data-wizard-step="${step}"] h2`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step]);

  const selectIndustry = (key: IndustryKey) => {
    setIndustry(key);
    setModules([...INDUSTRY_OPTIONS.find((option) => option.key === key)!.suggestedModules]);
  };
  const validateVisibleStep = () => {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-wizard-step="${step}"]`);
    const invalid = [...(panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select') ?? [])]
      .find((control) => !control.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return false;
    }
    return true;
  };
  const advance = () => {
    if (!validateVisibleStep()) return;
    setStepIssue(null);
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  };
  const finish = () => {
    if (!formRef.current || !validateVisibleStep()) return;
    const result = businessStepOf(new FormData(formRef.current));
    if (!result.ok) {
      setStepIssue(result);
      requestAnimationFrame(() => formRef.current
        ?.querySelector<HTMLElement>(`[name="${result.field}"]`)?.focus());
      return;
    }
    setStepIssue(null);
    formRef.current.requestSubmit();
  };

  const close = (open: boolean) => {
    if (open || pending) return;
    if ((companyName || industry) && !window.confirm('Discard this organization draft?')) return;
    router.push('/');
  };

  return (
    <Dialog.Root open onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="organization-wizard-overlay" />
        <Dialog.Content className="organization-wizard" aria-describedby="organization-wizard-description">
          <header className="organization-wizard-header">
            <div><p className="onboarding-kicker">New organization</p>
              <Dialog.Title>{companyName.trim() || 'Set up the business'}</Dialog.Title>
              <Dialog.Description id="organization-wizard-description">One organization. Five connected apps. Five focused choices.</Dialog.Description></div>
            <div className="organization-wizard-tools">
              <video className="organization-network-motion" autoPlay loop muted playsInline
                poster="/onboarding/organization-network-poster.webp" aria-hidden="true">
                <source src="/onboarding/organization-network-loop.webm" type="video/webm" />
              </video>
              <Dialog.Close className="organization-wizard-close" aria-label="Close" disabled={pending}>
                <WizardIcon name="close" />
              </Dialog.Close>
            </div>
          </header>
          <ol className="organization-progress" aria-label="Setup progress">
            {STEPS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''}
              aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
          </ol>
          <p className="organization-mobile-progress">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
          <form ref={formRef} action={submit} className="organization-wizard-form" aria-busy={pending}
            onInput={() => setStepIssue(null)}>
            <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
            <input type="hidden" name="blueprintKey" value={choice?.blueprint ?? ''} />
            <div ref={bodyRef} className="organization-wizard-body">
              <div hidden={step !== 0}><OrganizationOnboardingDetails mode="profile" name={companyName} industry={industry} kind={kind}
                ownerEmail={props.ownerEmail} onIndustryChange={selectIndustry} onKindChange={setKind}
                onNameChange={setCompanyName} invalidField={stepIssue?.field ?? null} /></div>
              <div hidden={step !== 1}><OrganizationOnboardingDetails mode="model" name={companyName} industry={industry} kind={kind}
                ownerEmail={props.ownerEmail} onIndustryChange={selectIndustry} onKindChange={setKind}
                onNameChange={setCompanyName} invalidField={stepIssue?.field ?? null} /></div>
              <div hidden={step !== 2}><OrganizationModuleStep industry={industry} selected={modules} onChange={setModules} /></div>
              <div hidden={step !== 3} className="onboarding-step" data-wizard-step="3">
                <McpStore cards={props.connectorCards} mode="select" selected={connectors} onChange={setConnectors} />
              </div>
              <div hidden={step !== 4}>{industry ? <OrganizationOnboardingDetails mode="details" name={companyName}
                industry={industry} kind={kind} ownerEmail={props.ownerEmail} onIndustryChange={selectIndustry}
                onKindChange={setKind} onNameChange={setCompanyName} invalidField={stepIssue?.field ?? null} /> : null}</div>
            </div>
            <footer className="organization-wizard-footer">
              <div aria-live="polite">{stepIssue || state.kind === 'error' ? <p id="organization-step-error" className="wizard-error" role="alert">{stepIssue?.error || state.message}</p>
                : <p>{step === STEPS.length - 1 ? `${modules.length} modules · ${connectors.length} MCP tools · 5 applications` : 'Your choices are preserved as you continue.'}</p>}</div>
              <div>{step > 0 ? <button type="button" className="wizard-button secondary" disabled={pending}
                onClick={() => setStep((value) => value - 1)}>Back</button> : null}
              <button type="button" className="wizard-button" disabled={pending}
                onClick={step < STEPS.length - 1 ? advance : finish}>
                {step === STEPS.length - 1 ? <WizardIcon name="complete" /> : null}
                {pending ? 'Provisioning…' : step < STEPS.length - 1 ? 'Continue' : 'Create organization'}
              </button></div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
