# Database

PostgreSQL 16 runs locally in Docker via `docker-compose.yml`. Prisma Migrate
owns the schema. Prisma Client is used for application data access;
parameterized raw SQL is limited to `SELECT ... FOR UPDATE SKIP LOCKED` when
claiming delivery jobs.

- Source of truth: `backend/prisma/schema.prisma`
- Applied migrations: `backend/prisma/migrations/`

## Tables

| Table | Purpose |
| --- | --- |
| `sources` | Webhook source configuration. Stores the signature header name and the *name* of the environment variable holding the secret. |
| `events` | Received payment events with their original JSONB payload, signature result and processing status. |
| `destinations` | The single configured delivery endpoint (name, URL, active flag, timeout). |
| `delivery_jobs` | Delivery state, attempt counter, next retry time, lock time, lock expiry, last response/error. |
| `delivery_attempts` | Every HTTP attempt with timestamps, status code, response time and outcome. |

## Relationships

```text
sources 1 ─── * events
events  1 ─── 1 delivery_jobs        (eventId is unique)
destinations 1 ─── * delivery_jobs
delivery_jobs 1 ─── * delivery_attempts
```

Deleting an event cascades to its job and attempts. Deleting a source or
destination is restricted while events/jobs reference it.

## Enums

| Enum | Values |
| --- | --- |
| `event_status` | `received`, `queued`, `processing`, `delivered`, `dead_letter` |
| `delivery_status` | `pending`, `processing`, `retrying`, `succeeded`, `dead_letter` |
| `attempt_outcome` | `succeeded`, `retryable_failure`, `permanent_failure` |

## Constraints and indexes

- `events (sourceId, externalEventId)` — unique; duplicate webhook prevention.
- `delivery_jobs.eventId` — unique; one job per event.
- `delivery_attempts (deliveryJobId, attemptNumber)` — unique; sequential history.
- `delivery_jobs (status, nextAttemptAt)` — processor polling.
- `delivery_jobs (status, lockExpiresAt)` — stale-processing-job recovery.
- `delivery_jobs (status, updatedAt)` — delivery-monitoring and dead-letter lists.
- `events.receivedAt`, `events.status`, `events.eventType` — dashboard filters.

The single destination is enforced by the Phase 3 configuration service rather
than a database singleton column. There is no multi-destination routing.

Prisma does not define database check constraints in the schema. Numeric and
state validation (for example `attemptCount <= maxAttempts`, timeouts) is
enforced in the service layer.

## Job processing

- A valid webhook creates the event and delivery job in one Prisma transaction.
  The event is `queued`; the job is `pending`, with `attemptCount = 0`,
  `maxAttempts = 5` and `nextAttemptAt` set to now.
- The in-process scheduler polls `delivery_jobs` every 2 seconds, 5 jobs per
  tick.
- Claiming uses a short transaction with parameterized
  `SELECT ... FOR UPDATE SKIP LOCKED`, then writes `processing`, `lockedAt` and
  a 30-second `lockExpiresAt` before committing.
- HTTP delivery happens after that transaction commits, so no database
  transaction is held open during network I/O.
- On startup, interrupted `processing` jobs are reset to `retrying`; each tick
  also recovers jobs with expired locks. No history is deleted.
- Success sets the job to `succeeded` and the event to `delivered`. A retryable
  failure sets the job to `retrying` with exponential backoff and jitter; a
  permanent failure, or a retryable failure at the fifth attempt, sets the job
  and event to `dead_letter`.
- Each attempt inserts one `delivery_attempts` row (`succeeded`,
  `retryable_failure` or `permanent_failure`) in the same transaction as the
  job/event status update.
- A destination `Retry-After` header is honored when it asks for a longer wait.
- Attempt history is retained for monitoring and dead-letter views.

There is no outbox table, outbox publisher, or separate worker process.

## Secrets

`WEBHOOK_SECRET` lives only in `backend/.env`. The `sources` table stores
`secretEnvVar = "WEBHOOK_SECRET"`, so the secret is never persisted or returned
by the API.

## Startup configuration

On every backend start, `configService.ensureConfig()`:

1. Finds the existing source (or creates one), updates it from
   `WEBHOOK_SOURCE_*`, and deactivates any other source rows.
2. Finds the existing destination (or creates one), updates it from
   `DESTINATION_*`, and deactivates any other destination rows.

This keeps configuration in sync without a separate seed command and without
creating duplicates. Destinations referenced by existing jobs are deactivated
rather than deleted.
