"use client";

import { useEffect, useState } from "react";
import { apiGet, queryString } from "../lib/api";
import { displayName } from "../lib/displayNames";
import { formatDateTime, shortId } from "../lib/format";
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Pagination,
  SectionHeader,
  StatusBadge,
} from "./ui";

const EMPTY_FILTERS = { search: "", eventType: "" };

function responseSummary(lastAttempt) {
  if (!lastAttempt) {
    return "—";
  }

  if (
    lastAttempt.httpStatusCode !== null &&
    lastAttempt.httpStatusCode !== undefined
  ) {
    const time =
      lastAttempt.responseTimeMs === null ||
      lastAttempt.responseTimeMs === undefined
        ? ""
        : ` · ${lastAttempt.responseTimeMs} ms`;
    return `HTTP ${lastAttempt.httpStatusCode}${time}`;
  }

  return lastAttempt.errorMessage || "—";
}

export default function DeadLetterSection({ onOpenEvent }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const path = `/api/dead-letter${queryString({
      ...applied,
      limit: 25,
      offset,
    })}`;

    setLoading(true);
    setError(null);

    apiGet(path, { signal: controller.signal })
      .then((result) => setData(result))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setError(requestError.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [applied, offset, refreshToken]);

  const applyFilters = (event) => {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setApplied({ ...EMPTY_FILTERS });
    setOffset(0);
  };

  const refresh = () => setRefreshToken((value) => value + 1);

  return (
    <section className="section">
      <SectionHeader
        eyebrow="Failed Events / Dead Letter Queue"
        title="Failed deliveries requiring investigation"
        description="View events that failed permanently or exhausted their maximum delivery attempts."
        onRefresh={refresh}
        refreshing={loading}
      />

      <form className="filters" onSubmit={applyFilters}>
        <label className="filter-field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Search by external event ID"
            value={filters.search}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                search: event.target.value,
              }))
            }
          />
        </label>

        <label className="filter-field">
          <span>Event type</span>
          <input
            type="text"
            placeholder="payment.failed"
            value={filters.eventType}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                eventType: event.target.value,
              }))
            }
          />
        </label>

        <div className="filter-actions">
          <button type="submit" className="button primary">
            Apply filters
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={resetFilters}
          >
            Reset
          </button>
        </div>
      </form>

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {loading && !data ? (
        <LoadingBlock label="Loading dead-letter queue…" />
      ) : null}

      {data ? (
        data.items.length === 0 ? (
          <EmptyState
            title="The dead-letter queue is empty"
            message="No event has permanently failed or exhausted its retries."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Failed at</th>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Attempts</th>
                    <th>Last response</th>
                    <th>Last outcome</th>
                    <th>Last error</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.deliveryJob.id}>
                      <td className="cell-nowrap">
                        {formatDateTime(item.deliveryJob.updatedAt)}
                      </td>
                      <td>
                        <div className="cell-title">
                          {item.event.externalEventId}
                        </div>
                        <div className="cell-sub">
                          {shortId(item.event.id)} ·{" "}
                          {displayName(item.destination.name)}
                        </div>
                      </td>
                      <td>
                        <span className="cell-mono">
                          {item.event.eventType}
                        </span>
                      </td>
                      <td>
                        {item.deliveryJob.attemptCount}/
                        {item.deliveryJob.maxAttempts}
                      </td>
                      <td>{responseSummary(item.lastAttempt)}</td>
                      <td>
                        <StatusBadge status={item.lastAttempt?.outcome} />
                      </td>
                      <td>
                        <div className="cell-error">
                          {item.deliveryJob.lastError || "—"}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenEvent(item.event.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              pagination={data.pagination}
              loading={loading}
              onPrevious={() =>
                setOffset((value) => Math.max(0, value - 25))
              }
              onNext={() => setOffset((value) => value + 25)}
            />
          </>
        )
      ) : null}
    </section>
  );
}
