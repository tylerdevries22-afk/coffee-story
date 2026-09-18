'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';

import { createOrganizationAction } from '@/app/(console)/organizations/actions';
import type { ConnectorCard } from '@/lib/integration-cards';
import { businessStepOf, type BusinessStepIssue } from '@/lib/organization-business-step';
import { ORGANIZATION_IDLE } from '@/lib/organization-action-state';
import { INDUSTRY_OPTIONS } from '@/lib/organization-onboarding';
import type { IndustryKey, OrganizationKind } from '@/lib/org-input';
import { MANUAL_PREFILL } from '@/lib/place-prefill';
import type { PlaceDraft } from '@/lib/place-to-draft';

import { McpStore } from './mcp-store';
import { OrganizationModuleStep } from './organization-module-step';
import { OrganizationOnboardingDetails } from './organization-onboarding-details';
import { OrganizationPlaceStep } from './organization-place-step';
import { PLACE_SEARCH_INPUT_ID } from './place-search';
import { usePlacePrefill } from './use-place-prefill';
import { WizardIcon } from './wizard-icon';

type WizardProps = {
  readonly idempotencyKey: string;
  readonly ownerEmail: string;
  readonly connectorCards: readonly ConnectorCard[];
  /** The deployment has a Places key, so step 0 leads with the Google search. */
  readonly placesReady: boolean;
};

const STEPS = ['Business', 'Organization', 'Modules', 'MCP Store', 'Details'] as const;
const UNDECIDED = 'Find the business on Google, or choose Enter details manually.';
const CLOSED_PENDING = 'Choose whether to use the closed listing, or search again.';

function suggestedModules(industry: IndustryKey): string[] {
  return [...(INDUSTRY_OPTIONS.find((option) => option.key === industry)?.suggestedModules ?? [])];
}

/** Escape closes an open suggestion list first; the dialog listens earlier, so it has to be told. */
function keepOpenForPopup(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement && event.target.getAttribute('aria-expanded') === 'true') event.preventDefault();
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const choice = INDUSTRY_OPTIONS.find((option) => option.key === industry);
  // A pick fills what the wizard holds itself; the rest remounts from the prefill.
  const applyPlace = useCallback((draft: PlaceDraft) => {
    setCompanyName(draft.name);
    setIndustry(draft.industry.key);
    setModules(suggestedModules(draft.industry.key));
    setNotice(null);
  }, []);
  const places = usePlacePrefill(applyPlace, props.placesReady ? null : MANUAL_PREFILL);
  const { edited, manual } = places;
  const enterManually = useCallback(() => {
    setNotice(null);
    manual();
  }, [manual]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    const frame = requestAnimationFrame(() => formRef.current
      ?.querySelector<HTMLElement>(`[data-wizard-step="${step}"] h2`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [step]);

  const selectIndustry = (key: IndustryKey) => {
    setIndustry(key);
    setModules(suggestedModules(key));
    edited('industry');
  };
  const changeName = (name: string) => {
    setCompanyName(name);
    edited('name');
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
    if (step === 0 && (places.pending || !places.prefill)) {
      setNotice(places.pending ? CLOSED_PENDING : UNDECIDED);
      document.getElementById(PLACE_SEARCH_INPUT_ID)?.focus();
      return;
    }
    if (!validateVisibleStep()) return;
    setStepIssue(null);
    setNotice(null);
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  };
  const finish = () => {
    if (!formRef.current || !validateVisibleStep()) return;
    const result = businessStepOf(new FormData(formRef.current));
    if (!result.ok) {
      setStepIssue(result);
      requestAnimationFrame(() => formRef.current
        ?.querySelector<HTMLElement>(`[data-field="${result.field}"], [name="${result.field}"]`)?.focus());
      return;
    }
    setStepIssue(null);
    formRef.current.requestSubmit();
  };

  const details = {
    name: companyName, kind, ownerEmail: props.ownerEmail, prefill: places.prefill, onKindChange: setKind,
    onNameChange: changeName, onEdited: edited, invalidField: stepIssue?.field ?? null,
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
        <Dialog.Content className="organization-wizard" aria-describedby="organization-wizard-description"
          onEscapeKeyDown={keepOpenForPopup}>
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
            onInput={() => { setStepIssue(null); setNotice(null); }}>
            <input type="hidden" name="idempotencyKey" value={props.idempotencyKey} />
            <input type="hidden" name="blueprintKey" value={choice?.blueprint ?? ''} />
            <div ref={bodyRef} className="organization-wizard-body">
              <div hidden={step !== 0}><OrganizationPlaceStep placesReady={props.placesReady} prefill={places.prefill}
                pending={places.pending} industry={industry} onResolved={places.resolved} onConfirm={places.confirm}
                onDiscard={places.discard} onManual={enterManually} onIndustryChange={selectIndustry} /></div>
              <div hidden={step !== 1}><OrganizationOnboardingDetails mode="model" {...details} /></div>
              <div hidden={step !== 2}><OrganizationModuleStep industry={industry} selected={modules} onChange={setModules} /></div>
              <div hidden={step !== 3} className="onboarding-step" data-wizard-step="3">
                <McpStore cards={props.connectorCards} mode="select" selected={connectors} onChange={setConnectors} />
              </div>
              <div hidden={step !== 4}>{industry ? <OrganizationOnboardingDetails mode="details" {...details} /> : null}</div>
            </div>
            <footer className="organization-wizard-footer">
              <div aria-live="polite">{stepIssue || notice || state.kind === 'error' ? <p id="organization-step-error" className="wizard-error" role="alert">{stepIssue?.error || notice || state.message}</p>
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
