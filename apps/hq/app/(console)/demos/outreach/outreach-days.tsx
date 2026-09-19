import type { OutreachDaySummary } from '@/lib/demo-factory/outreach-summary';

/**
 * One row per day of the window. A download is a plain form post to the
 * export route, which answers with the file and leaves this page where it
 * is; downloading again gives the same file, because nothing is marked sent.
 */
export function OutreachDays({ days, ready }: { days: readonly OutreachDaySummary[]; ready: boolean }) {
  return (
    <section className="card outreach-days">
      <h2>By day</h2>
      <p className="factory-muted">
        A demo gets a draft when it is ready, its business is in the US, its website publishes an address, and
        its link has at least two days left. “Other” is the rest: still building, removed, expired or outside the US.
      </p>
      <table>
        <thead>
          <tr>
            <th>Day (UTC)</th><th className="num">Demos</th><th className="num">Drafts</th>
            <th className="num">No address</th><th className="num">Other</th><th><span className="sr-only">Download</span></th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <td>{day.day}</td>
              <td className="num">{day.built}</td>
              <td className="num">{day.drafts}</td>
              <td className="num">{day.skipped.no_email}</td>
              <td className="num">{day.skipped.not_ready + day.skipped.outside_us + day.skipped.expiring}</td>
              <td>
                <form method="post" action="/api/demos/outreach">
                  <input type="hidden" name="day" value={day.day} />
                  <button className="button secondary" type="submit" disabled={!ready || day.drafts === 0}>
                    Download CSV<span className="sr-only"> for {day.day}</span>
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
