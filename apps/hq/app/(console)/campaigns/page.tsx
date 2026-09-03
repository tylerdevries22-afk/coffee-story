import { selectedConsoleCapabilities } from '@/lib/console-capability';
import { loadCampaigns } from '@/lib/data';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


export default async function CampaignsPage() {
  // Same reason as /drops: the rail gate and the route gate are two different
  // gates, and only one of them is reached by pasting a URL.
  const capabilities = await selectedConsoleCapabilities();
  if (!capabilities.growth) {
    return (
      <>
        <h1>Campaigns</h1>
        <div className="notice">This brand has no growth module installed to campaign for.</div>
      </>
    );
  }
  const campaigns = await loadCampaigns();
  return (
    <>
      <h1>Campaigns</h1>
      <p className="subtitle">Push, SMS, and email. Sends run through the engine with per-channel opt-in enforced.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Campaign</th><th>Channel</th><th>Audience</th><th>Status</th><th className="num">Sent</th><th className="num">Redeemed</th></tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td><strong>{campaign.name}</strong></td>
                <td>{campaign.channel}</td>
                <td>{campaign.audience}</td>
                <td>
                  <span className={campaign.status === 'sent' ? 'pill success' : campaign.status === 'scheduled' ? 'pill accent' : 'pill'}>
                    {campaign.status}
                  </span>
                </td>
                <td className="num">{campaign.sent.toLocaleString('en-US')}</td>
                <td className="num">{campaign.redeemed.toLocaleString('en-US')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>New campaign</h2>
        <div className="grid-2">
          <div>
            <label className="field">Name<input placeholder="Weekend drop reminder" /></label>
            <label className="field">Channel
              <select><option>push</option><option>sms</option><option>email</option></select>
            </label>
            <label className="field">Audience
              <select>
                <option>Everyone</option>
                <option>Lapsed 30 days</option>
                <option>Loyalty 500+ points</option>
                <option>Ordered the last drop</option>
              </select>
            </label>
            <label className="field">Schedule<input type="datetime-local" /></label>
          </div>
          <div>
            <label className="field">Subject (email only)<input placeholder="It's back" /></label>
            <label className="field">Message<textarea rows={6} placeholder="The Honey Lavender Latte returns Friday…" /></label>
          </div>
        </div>
        <button className="button" type="button">Save draft</button>
      </div>
    </>
  );
}
