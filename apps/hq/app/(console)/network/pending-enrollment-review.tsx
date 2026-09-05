import { agreementTerms } from '@/lib/franchise-enrollment';
import { loadPendingEnrollments } from '@/lib/franchise-enrollment-data';

import { respondToNetworkEnrollmentAction } from './enrollment-actions';

export async function PendingEnrollmentReview({ brandId }: { brandId: string }) {
  const { enrollments, unavailable } = await loadPendingEnrollments(brandId);
  if (unavailable) {
    return <div className="notice danger" role="status">Pending agreements could not be loaded.</div>;
  }
  if (enrollments.length === 0) return null;
  return (
    <section aria-labelledby="agreement-review-heading">
      <p className="eyebrow">Owner decision required</p>
      <h2 id="agreement-review-heading">Franchise agreement review</h2>
      <p className="subtitle">
        Accepting activates this brand&apos;s network membership and agreement. Production remains
        blocked until the separate readiness review passes.
      </p>
      {enrollments.map((enrollment) => (
        <article className="card" key={enrollment.agreementId}>
          <h3>Pending network enrollment</h3>
          <p className="muted">
            Received {new Date(enrollment.createdAt).toLocaleDateString('en-US')} · Agreement
            revision {enrollment.inheritanceRevision}
          </p>
          <p className="muted">Network reference: {enrollment.networkId}</p>
          <dl>
            <dt><strong>Territory terms</strong></dt>
            <dd>{agreementTerms(enrollment.territory, 'No territory terms supplied.')}</dd>
            <dt><strong>Inherited network policy</strong></dt>
            <dd>{agreementTerms(enrollment.inheritancePolicy, 'No inherited policy supplied.')}</dd>
          </dl>
          <div className="location-form-actions">
            <form action={respondToNetworkEnrollmentAction}>
              <input type="hidden" name="brandId" value={brandId} />
              <input type="hidden" name="networkId" value={enrollment.networkId} />
              <input type="hidden" name="decision" value="reject" />
              <button className="button danger" type="submit">Decline enrollment</button>
            </form>
            <form action={respondToNetworkEnrollmentAction}>
              <input type="hidden" name="brandId" value={brandId} />
              <input type="hidden" name="networkId" value={enrollment.networkId} />
              <input type="hidden" name="decision" value="accept" />
              <button className="button" type="submit">Accept agreement</button>
            </form>
          </div>
        </article>
      ))}
    </section>
  );
}
