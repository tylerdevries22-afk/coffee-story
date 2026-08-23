/**
 * Public per-tenant status stub: /status/<slug>. Real signals (ordering API
 * checks, webhook freshness) wire in from Checkly's API; until then it is an
 * honest static frame that never claims green it cannot verify.
 */
export default async function StatusPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const services = [
    { name: 'Ordering', detail: 'Placing and paying for orders' },
    { name: 'Order updates', detail: 'Live status on the board and tracker' },
    { name: 'Loyalty', detail: 'Earning and redeeming points' },
  ];
  return (
    <>
      <h1>{tenant} — service status</h1>
      <p className="subtitle">Live checks publish here once monitoring is connected for this tenant.</p>
      {services.map((service) => (
        <div className="card" key={service.name}>
          <h2>{service.name}</h2>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>{service.detail}</p>
          <p style={{ margin: '8px 0 0' }}><span className="pill">status pending monitoring hookup</span></p>
        </div>
      ))}
    </>
  );
}
