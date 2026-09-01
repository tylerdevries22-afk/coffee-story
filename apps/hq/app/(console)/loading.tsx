export default function ConsoleLoading() {
  return (
    <div className="hq-dashboard hq-dashboard-loading" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the HQ workspace</span>
      <div className="hq-skeleton hq-skeleton-heading" />
      <div className="hq-metric-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div className="hq-skeleton hq-skeleton-metric" key={index} />)}
      </div>
      <div className="hq-dashboard-grid" aria-hidden="true">
        <div className="hq-skeleton hq-skeleton-panel" />
        <div className="hq-skeleton hq-skeleton-panel" />
      </div>
    </div>
  );
}
