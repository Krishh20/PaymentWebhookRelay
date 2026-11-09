"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { displayName } from "../lib/displayNames";
import { formatDateTime, shortId } from "../lib/format";
import { ErrorBanner, LoadingBlock, StatusBadge } from "./ui";

function DetailGrid({ items }) {
  return (
    <dl className="detail-grid">
      {items.map((item) => (
        <div className="detail-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function AttemptsTable({ attempts }) {
  if (!attempts || attempts.length === 0) {
    return <p className="muted">No attempts recorded.</p>;
  }

  return (
    <div className="table-wrap compact">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Outcome</th>
            <th>Requested</th>
            <th>HTTP</th>
            <th>Time</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => (
            <tr key={attempt.id}>
              <td>{attempt.attemptNumber}</td>
              <td>
                <StatusBadge status={attempt.outcome} />
              </td>
              <td className="cell-nowrap">
                {formatDateTime(attempt.requestedAt)}
              </td>
              <td>
                {attempt.httpStatusCode === null ||
                attempt.httpStatusCode === undefined
                  ? "—"
                  : attempt.httpStatusCode}
              </td>
              <td>
                {attempt.responseTimeMs === null ||
                attempt.responseTimeMs === undefined
                  ? "—"
                  : `${attempt.responseTimeMs} ms`}
              </td>
              <td className="cell-error">{attempt.errorMessage || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DetailDrawer({ target, onClose }) {
  const [state, setState] = useState({
    data: null,
    loading: false,
    error: null,
  });

  const targetType = target?.type;
  const targetId = target?.id;

  useEffect(() => {
    if (!targetType || !targetId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }

    const controller = new AbortController();
    const path =
      targetType === "event"
        ? `/api/events/${targetId}`
        : `/api/deliveries/${targetId}`;

    setState({ data: null, loading: true, error: null });

    apiGet(path, { signal: controller.signal })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") {
          setState({
            data: null,
            loading: false,
            error: requestError.message,
          });
        }
      });

    return () => controller.abort();
  }, [targetType, targetId]);

  useEffect(() => {
    if (!target) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, onClose]);

  if (!target) {
    return null;
  }

  const isEvent = targetType === "event";
  const data = state.data;
  const event = isEvent ? data : data?.event;
  const job = isEvent ? data?.deliveryJob : data;

  return (
    <div
      className="drawer-overlay"
      onClick={onClose}
      role="presentation"
    >
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEvent ? "Event detail" : "Delivery detail"}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <p className="eyebrow">{isEvent ? "Event detail" : "Delivery detail"}</p>
            <h2 className="drawer-title">
              {event?.externalEventId || "Loading…"}
            </h2>
            {event ? (
              <div className="drawer-subtitle">
                <span className="cell-mono">{event.eventType}</span>
                <span className="dot-separator">·</span>
                <StatusBadge status={event.status} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close detail"
          >
            ×
          </button>
        </header>

        <div className="drawer-body">
          {state.loading ? <LoadingBlock label="Loading detail…" /> : null}
          {state.error ? <ErrorBanner message={state.error} /> : null}

          {data ? (
            <>
              <section className="drawer-section">
                <h3>{isEvent ? "Event" : "Delivery job"}</h3>
                <DetailGrid
                  items={
                    isEvent
                      ? [
                          { label: "Event ID", value: data.id },
                          {
                            label: "Received",
                            value: formatDateTime(data.receivedAt),
                          },
                          {
                            label: "Source",
                            value: displayName(data.source.name),
                          },
                          {
                            label: "Signature verified",
                            value: data.signatureVerified ? "Yes" : "No",
                          },
                          {
                            label: "Status",
                            value: <StatusBadge status={data.status} />,
                          },
                        ]
                      : [
                          { label: "Job ID", value: data.id },
                          {
                            label: "Updated",
                            value: formatDateTime(data.updatedAt),
                          },
                          {
                            label: "Status",
                            value: <StatusBadge status={data.status} />,
                          },
                          {
                            label: "Attempts",
                            value: `${data.attemptCount}/${data.maxAttempts}`,
                          },
                          {
                            label: "Next attempt",
                            value: formatDateTime(data.nextAttemptAt),
                          },
                          {
                            label: "Locked until",
                            value: formatDateTime(data.lockExpiresAt),
                          },
                        ]
                  }
                />
              </section>

              {job ? (
                <section className="drawer-section">
                  <h3>Delivery</h3>
                  <DetailGrid
                    items={[
                      {
                        label: "Job ID",
                        value: job.id,
                      },
                      {
                        label: "Job status",
                        value: <StatusBadge status={job.status} />,
                      },
                      {
                        label: "Attempts",
                        value: `${job.attemptCount}/${job.maxAttempts}`,
                      },
                      {
                        label: "Last HTTP status",
                        value:
                          job.lastStatusCode === null ||
                          job.lastStatusCode === undefined
                            ? "—"
                            : job.lastStatusCode,
                      },
                      {
                        label: "Last response time",
                        value:
                          job.lastResponseTimeMs === null ||
                          job.lastResponseTimeMs === undefined
                            ? "—"
                            : `${job.lastResponseTimeMs} ms`,
                      },
                      {
                        label: "Last error",
                        value: job.lastError || "—",
                      },
                      {
                        label: "Destination",
                        value: displayName(job.destination?.name),
                      },
                      {
                        label: "Destination URL",
                        value: (
                          <span className="break-all">
                            {job.destination?.url}
                          </span>
                        ),
                      },
                    ]}
                  />
                </section>
              ) : null}

              {event ? (
                <section className="drawer-section">
                  <h3>Event payload</h3>
                  <pre className="code-block">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </section>
              ) : null}

              <section className="drawer-section">
                <h3>Attempt history</h3>
                <AttemptsTable attempts={job?.attempts} />
              </section>

              {!isEvent && event ? (
                <section className="drawer-section">
                  <h3>Event summary</h3>
                  <DetailGrid
                    items={[
                      {
                        label: "External event ID",
                        value: event.externalEventId,
                      },
                      {
                        label: "Event ID",
                        value: event.id,
                      },
                      {
                        label: "Received",
                        value: formatDateTime(event.receivedAt),
                      },
                      {
                        label: "Source",
                        value: displayName(event.source?.name),
                      },
                    ]}
                  />
                  <p className="subsection-note">
                    Event record {shortId(event.id)} · signature{" "}
                    {event.signatureVerified ? "verified" : "not verified"}
                  </p>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
