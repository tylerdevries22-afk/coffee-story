import {
  LOADER_STEPS,
  loaderProgressFromFactoryRun,
  type FactoryLoaderInput,
} from '@platform/factory';

type Props = {
  readonly run: FactoryLoaderInput;
  readonly className?: string;
};

/**
 * Full-screen four-step loader for new-shop provisioning.
 * Steps: Business saved → Database → Apps → Ready.
 * Always names THAT shop — never Coffee Story.
 */
export function ProvisioningLoader({ run, className }: Props) {
  const progress = loaderProgressFromFactoryRun(run);
  return (
    <section
      className={['provisioning-loader', className].filter(Boolean).join(' ')}
      aria-label={`${progress.shopName} setup progress`}
      data-shop-name={progress.shopName}
    >
      <p className="provisioning-loader-kicker">Setting up</p>
      <h2 className="provisioning-loader-title">{progress.shopName}</h2>
      <ol className="provisioning-loader-steps">
        {LOADER_STEPS.map((label, index) => {
          const state = index < progress.activeIndex
            ? 'complete'
            : index === progress.activeIndex
              ? 'active'
              : 'pending';
          return (
            <li key={label} className={state} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="provisioning-loader-index">{index + 1}</span>
              <span className="provisioning-loader-label">{label}</span>
            </li>
          );
        })}
      </ol>
      {progress.awaitingGoLive ? (
        <p className="provisioning-loader-note" role="status">
          Sandbox is ready. An owner or platform admin must tap Go live to mint
          production hosts.
        </p>
      ) : null}
    </section>
  );
}
