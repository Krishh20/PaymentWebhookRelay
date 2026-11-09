"use client";

import { useEffect, useState } from "react";
import { apiGet, queryString } from "../lib/api";
import { formatDateTime, shortId } from "../lib/format";
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Pagination,
  SectionHeader,
  StatusBadge,
} from "./ui";

const EMPTY_FILTERS = { search: "", status: "", eventType: "" };
const STATUS_OPTIONS = [
  "received",
  "queued",
  "processing",
  "delivered",
  "dead_letter",
];

function responseSummary(job) {
  if (!job) {
    return "—";
  }

  if (job.lastStatusCode !== null && job.lastStatusCode !== undefined) {
    const time =
      job.lastResponseTimeMs === null || job.lastResponseTimeMs === undefined
        ? ""
        : ` · ${job.lastResponseTimeMs} ms`;
    return `HTTP ${job.lastStatusCode}${time}`;
  }

  return job.lastError || "—";
}

export default function EventsSection({ onOpenEvent }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const path = `/api/events${queryString({
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
        eyebrow="Events"
        title="Inbound webhook events"
        description="Verified events, their delivery state and latest response."
        onRefresh={refresh}
        refreshing={loading}
      />

      <form className="filters" onSubmit={applyFilters}>
        <label className="filter-field">
          <span>Search</span>
          <input
            type="search"
            placeholder="External event ID"
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
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value,
              }))
            }
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span>Event type</span>
          <input
            type="text"
            placeholder="payment.success"
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

      {loading && !data ? <LoadingBlock label="Loading events…" /> : null}

      {data ? (
        data.items.length === 0 ? (
          <EmptyState
            title="No events match these filters"
            message="Send a signed webhook to the relay, or clear the filters to see everything."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Received</th>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Delivery</th>
                    <th>Last response</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((event) => (
                    <tr key={event.id}>
                      <td className="cell-nowrap">
                        {formatDateTime(event.receivedAt)}
                      </td>
                      <td>
                        <div className="cell-title">
                          {event.externalEventId}
                        </div>
                        <div className="cell-sub">
                          {shortId(event.id)} · {event.source.name}
                        </div>
                      </td>
                      <td>
                        <span className="cell-mono">{event.eventType}</span>
                      </td>
                      <td>
                        <StatusBadge status={event.status} />
                      </td>
                      <td>
                        {event.deliveryJob ? (
                          <>
                            <StatusBadge status={event.deliveryJob.status} />
                            <div className="cell-sub">
                              {event.deliveryJob.attemptCount}/
                              {event.deliveryJob.maxAttempts} attempts
                            </div>
                          </>
                        ) : (
                          <span className="muted">No job</span>
                        )}
                      </td>
                      <td>
                        <div>{responseSummary(event.deliveryJob)}</div>
                        {event.deliveryJob?.lastError &&
                        event.deliveryJob.lastStatusCode !== null ? (
                          <div className="cell-sub cell-error">
                            {event.deliveryJob.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenEvent(event.id)}
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
