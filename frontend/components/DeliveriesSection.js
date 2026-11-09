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
  "pending",
  "processing",
  "retrying",
  "succeeded",
  "dead_letter",
];

function responseSummary(job) {
  if (job.lastStatusCode !== null && job.lastStatusCode !== undefined) {
    const time =
      job.lastResponseTimeMs === null || job.lastResponseTimeMs === undefined
        ? ""
        : ` · ${job.lastResponseTimeMs} ms`;
    return `HTTP ${job.lastStatusCode}${time}`;
  }

  return job.lastError || "—";
}

export default function DeliveriesSection({ onOpenDelivery }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const path = `/api/deliveries${queryString({
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
        eyebrow="Delivery Monitoring"
        title="Outbound delivery jobs"
        description="Claim state, retry schedule and the latest destination response."
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

      {loading && !data ? (
        <LoadingBlock label="Loading delivery jobs…" />
      ) : null}

      {data ? (
        data.items.length === 0 ? (
          <EmptyState
            title="No delivery jobs match these filters"
            message="Jobs appear here as soon as an event is stored."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Updated</th>
                    <th>Event</th>
                    <th>Type</th>
                    <th>Delivery</th>
                    <th>Attempts</th>
                    <th>Next attempt</th>
                    <th>Last response</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((job) => (
                    <tr key={job.id}>
                      <td className="cell-nowrap">
                        {formatDateTime(job.updatedAt)}
                      </td>
                      <td>
                        <div className="cell-title">
                          {job.event.externalEventId}
                        </div>
                        <div className="cell-sub">
                          {shortId(job.event.id)} · {job.destination.name}
                        </div>
                      </td>
                      <td>
                        <span className="cell-mono">
                          {job.event.eventType}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={job.status} />
                      </td>
                      <td>
                        {job.attemptCount}/{job.maxAttempts}
                      </td>
                      <td className="cell-nowrap">
                        {job.status === "retrying" ||
                        job.status === "pending" ||
                        job.status === "processing"
                          ? formatDateTime(job.nextAttemptAt)
                          : "—"}
                      </td>
                      <td>
                        <div>{responseSummary(job)}</div>
                        {job.lastError ? (
                          <div className="cell-sub cell-error">
                            {job.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onOpenDelivery(job.id)}
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
