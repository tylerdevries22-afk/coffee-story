import { currentSession, hasRole } from '@/lib/auth';

export default async function OnboardingPage() {
  const session = await currentSession();
  const admin = hasRole(session, 'platform_admin');
  return (
    <>
      <h1>Onboarding</h1>
      <p className="subtitle">Adding a brand or location drives <code>pnpm onboard</code> — the same idempotent script every time.</p>

      {admin ? (
        <div className="card">
          <h2>Add a brand</h2>
          <div className="grid-2">
            <div>
              <label className="field">Brand name<input placeholder="Demo Roastery" /></label>
              <label className="field">Slug<input placeholder="demo-roastery" /></label>
              <label className="field">Fee (bps)<input type="number" defaultValue={300} /></label>
              <label className="field">Tier-2 fee (bps)<input type="number" defaultValue={150} /></label>
              <label className="field">Tier threshold ($/month)<input type="number" defaultValue={20000} /></label>
            </div>
            <div className="notice" style={{ marginBottom: 0 }}>
              Creating a brand copies <code>tenants/_template/</code> to
              <code> tenants/&lt;slug&gt;/</code>, writes this form into
              <code> brand.json</code>, then runs
              <code> pnpm onboard --tenant &lt;slug&gt;</code>: brand + location
              rows, menu seed from <code>menu.csv</code>, generated icons and
              splash, Expo config, and the app-store listing checklist.
            </div>
          </div>
          <button className="button" type="button">Create brand</button>
        </div>
      ) : null}

      <div className="card">
        <h2>Add a location</h2>
        <div className="grid-2">
          <div>
            <label className="field">Location name<input placeholder="Uptown" /></label>
            <label className="field">Street<input placeholder="2500 North Ave" /></label>
            <label className="field">City<input placeholder="Denver" /></label>
            <label className="field">Timezone<input defaultValue="America/Denver" /></label>
          </div>
          <div className="notice" style={{ marginBottom: 0 }}>
            The new location starts with the brand&rsquo;s default hours and no
            Square connection — connect it from Locations once it exists.
            Multi-location features switch on automatically when a second
            location lands (rule 5&rsquo;s <code>multi_location</code> flag).
          </div>
        </div>
        <button className="button" type="button">Create location</button>
      </div>
    </>
  );
}
