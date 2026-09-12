import { goLiveOrganizationAction } from '../go-live-actions';

export function GoLiveBanner({ brandId, slug }: { brandId: string; slug: string }) {
  return (
    <div className="card readiness-summary">
      <div>
        <h2>Go live</h2>
        <p className="muted">
          Sandbox uses preview Supabase, SQUARE_ENV=sandbox, and factory canary.
          Tapping Go live mints {slug}-hq.vercel.app and {slug}-display.vercel.app.
          Guest apps stay paths on HQ. Parked customer/kiosk/operator projects are left alone.
        </p>
      </div>
      <form action={goLiveOrganizationAction}>
        <input type="hidden" name="brandId" value={brandId} />
        <button className="button" type="submit">Go live</button>
      </form>
    </div>
  );
}
