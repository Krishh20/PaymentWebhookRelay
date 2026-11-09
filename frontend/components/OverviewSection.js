"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import {
  formatNumber,
  formatPercent,
  percent,
} from "../lib/format";
import {
  ErrorBanner,
  LoadingBlock,
  SectionHeader,
} from "./ui";

const EVENT_STATUSES = [
  "received",
  "queued",
  "processing",
  "delivered",
  "dead_letter",
];
const DELIVERY_STATUSES = [
  "pending",
  "processing",
  "retrying",
  "succeeded",
  "dead_letter",
];
const ATTEMPT_OUTCOMES = [
  "succeeded",
  "retryable_failure",
  "permanent_failure",
];

function Breakdown({ title, counts, total, order }) {
  const values = order || Object.keys(counts);

  return (
    <article className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-total">{formatNumber(total)}</span>
      </div>
      <div className="breakdown-list">
        {values.map((key) => {
          const value = counts[key] || 0;
          const share = percent(value, total);

          return (
            <div className="breakdown-row" key={key}>
              <div className="breakdown-meta">
                <span className="breakdown-label">
                  {key.replaceAll("_", " ")}
                </span>
                <span className="breakdown-count">
                  {formatNumber(value)}
                  {total > 0 ? (
                    <span className="breakdown-share">{share}%</span>
                  ) : null}
                </span>
              </div>
              <div className="breakdown-track">
                <div
                  className={`breakdown-fill fill-${key}`}
                  style={{ width: `${share}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default function OverviewSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    apiGet("/api/overview", { signal: controller.signal })
      .then((result) => {
        setData(result);
      })
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
  }, [refreshToken]);

  const refresh = () => setRefreshToken((value) => value + 1);

  const jobs = data?.deliveryJobs?.byStatus;
  const inFlight = jobs
    ? jobs.pending + jobs.processing + jobs.retrying
    : 0;

  return (
    <section className="section">
      <SectionHeader
        eyebrow="Overview"
        title="Relay health at a glance"
        description="Monitor incoming events, delivery performance and retry activity."
        onRefresh={refresh}
        refreshing={loading}
      />

      {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}

      {loading && !data ? (
        <LoadingBlock label="Loading overview…" />
      ) : null}

      {data ? (
        <>
          <div className="stats-grid">
            <article className="stat-card accent-blue">
              <p className="stat-label">Events received</p>
              <p className="stat-value">{formatNumber(data.events.total)}</p>
              <p className="stat-hint">
                {formatNumber(data.events.last24Hours)} in the last 24 hours
              </p>
            </article>

            <article className="stat-card accent-green">
              <p className="stat-label">Delivered events</p>
              <p className="stat-value">
                {formatNumber(data.events.byStatus.delivered)}
              </p>
              <p className="stat-hint">
                {percent(
                  data.events.byStatus.delivered,
                  data.events.total,
                )}
                % of all events
              </p>
            </article>

            <article className="stat-card accent-red">
              <p className="stat-label">Dead-letter events</p>
              <p className="stat-value">
                {formatNumber(data.events.byStatus.dead_letter)}
              </p>
              <p className="stat-hint">
                {percent(
                  data.events.byStatus.dead_letter,
                  data.events.total,
                )}
                % of all events
              </p>
            </article>

            <article className="stat-card accent-amber">
              <p className="stat-label">In-flight deliveries</p>
              <p className="stat-value">{formatNumber(inFlight)}</p>
              <p className="stat-hint">Pending, processing or retrying</p>
            </article>

            <article className="stat-card accent-violet">
              <p className="stat-label">Delivery success rate</p>
              <p className="stat-value">
                {formatPercent(data.deliveryJobs.successRate)}
              </p>
              <p className="stat-hint">
                Successful deliveries out of completed jobs.
              </p>
            </article>

            <article className="stat-card accent-cyan">
              <p className="stat-label">Attempts recorded</p>
              <p className="stat-value">{formatNumber(data.attempts.total)}</p>
              <p className="stat-hint">
                {formatNumber(data.attempts.last24Hours)} in the last 24 hours
              </p>
            </article>
          </div>

          <div className="panel-grid">
            <Breakdown
              title="Events by status"
              counts={data.events.byStatus}
              total={data.events.total}
              order={EVENT_STATUSES}
            />
            <Breakdown
              title="Delivery jobs by status"
              counts={data.deliveryJobs.byStatus}
              total={data.deliveryJobs.total}
              order={DELIVERY_STATUSES}
            />
            <Breakdown
              title="Attempt outcomes"
              counts={data.attempts.byOutcome}
              total={data.attempts.total}
              order={ATTEMPT_OUTCOMES}
            />
          </div>

          <p className="section-footnote">
            Active destinations: {formatNumber(data.destinations.active)} ·
            Updated {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </>
      ) : null}
    </section>
  );
}
