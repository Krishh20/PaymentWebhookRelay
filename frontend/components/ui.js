export function StatusBadge({ status }) {
  if (!status) {
    return <span className="muted">—</span>;
  }

  return (
    <span className={`badge status-${status}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  onRefresh,
  refreshing,
  children,
}) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="section-title">{title}</h1>
        {description ? <p className="section-desc">{description}</p> : null}
      </div>
      <div className="section-actions">
        {children}
        <button
          type="button"
          className="button secondary"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="link-button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <div className="empty-mark">∅</div>
      <p className="empty-title">{title}</p>
      <p className="empty-message">{message}</p>
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }) {
  return (
    <div className="loading-block" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Pagination({
  pagination,
  onPrevious,
  onNext,
  loading = false,
}) {
  if (!pagination) {
    return null;
  }

  const { total, limit, offset } = pagination;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <div className="pagination">
      <p className="pagination-info">
        Showing {start}–{end} of {total}
      </p>
      <div className="pagination-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onPrevious}
          disabled={loading || offset === 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={onNext}
          disabled={loading || !pagination.hasMore}
        >
          Next
        </button>
      </div>
    </div>
  );
}
