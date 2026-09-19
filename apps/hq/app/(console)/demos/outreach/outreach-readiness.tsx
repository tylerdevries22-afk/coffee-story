const SETTINGS: readonly { readonly name: string; readonly why: string }[] = [
  { name: 'DEMO_BUILDER_NAME', why: 'signs every draft and names the advertiser' },
  { name: 'DEMO_BUILDER_POSTAL_ADDRESS', why: 'your valid postal address, which every commercial email must carry' },
  { name: 'NEXT_PUBLIC_HQ_URL', why: 'the https console address every demo link starts with' },
  { name: 'DEMO_LINK_SECRET', why: 'derives each demo’s link' },
];

/**
 * What an export needs, and what stays the operator's once the file leaves
 * HQ. The second list is the part of CAN-SPAM a draft cannot carry for them.
 */
export function OutreachReadinessPanel({ missing }: { missing: readonly string[] }) {
  const ready = missing.length === 0;
  return (
    <div className="factory-layout">
      <section className="factory-panel">
        <div className="factory-panel-heading">
          <div><p className="factory-eyebrow">Settings</p><h2>{ready ? 'Ready to export' : 'Not ready to export'}</h2></div>
          <span className={ready ? 'factory-state factory-state-running' : 'factory-state'}>{ready ? 'ready' : 'blocked'}</span>
        </div>
        <ul className="factory-muted">
          {SETTINGS.map((setting) => (
            <li key={setting.name}>
              <strong>{missing.includes(setting.name) ? 'Missing' : 'Configured'}</strong>: {setting.name}, {setting.why}.
            </li>
          ))}
        </ul>
      </section>
      <section className="factory-panel">
        <div className="factory-panel-heading">
          <div><p className="factory-eyebrow">Before you send</p><h2>What stays yours</h2></div>
        </div>
        <ul className="factory-muted">
          <li>
            Send from your own cold-email tool, on a domain that is not the one your receipts come from, so a
            complaint cannot reach your transactional mail.
          </li>
          <li>Keep the From name and reply address accurate, and keep your tool’s unsubscribe link in every email.</li>
          <li>Honour every unsubscribe, by reply or by link, within ten business days, and never email that address again.</li>
          <li>
            Every business in these files is in the US, where a first email is allowed as long as opt-outs are
            honoured. Other countries ask for consent first, which is why none are here.
          </li>
        </ul>
      </section>
    </div>
  );
}
