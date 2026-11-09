# Mini Payment Webhook Relay

A learning project that receives payment webhook events, verifies their HMAC
signatures, prevents duplicates, stores them reliably, delivers them to one
configured endpoint, retries temporary failures, and exposes a monitoring
dashboard.

## Stack

- **Frontend:** Next.js 16 (JavaScript, plain CSS), read-only dashboard
- **Backend:** Node.js, Express.js, JavaScript
- **Database:** PostgreSQL 16 (local Docker container)
- **Data access:** Prisma ORM for application queries and transactions

> Approved deviation from the original brief: PostgreSQL runs via Docker, and
> Prisma Migrate owns the schema instead of hand-written migration scripts.
> Prisma Client is used for normal data access. Parameterized raw SQL is used
> only for `SELECT ... FOR UPDATE SKIP LOCKED` when claiming delivery jobs.
> There is no transactional outbox, no separate worker, and only one Express
> process. The application itself is not containerized.

## Project structure

```text
.
├── backend/
│   ├── config/          # Environment configuration
│   ├── controllers/     # HTTP request/response handling
│   ├── db/              # Prisma client
│   ├── middleware/      # Express middleware
│   ├── prisma/          # Prisma schema and migrations
│   ├── routes/          # Express routers
│   ├── services/        # Business logic
│   ├── utils/           # Shared helpers
│   ├── app.js
│   └── server.js
├── database/            # Database documentation (Prisma owns schema)
├── frontend/            # Next.js read-only dashboard
├── tests/               # Integration tests (Phase 11)
├── docker-compose.yml   # Local PostgreSQL only
└── .env.example
```

## Requirements

- Node.js 20+
- Docker Desktop (for the local PostgreSQL container)

## Phase 1: setup and run

```bash
# 1. Start PostgreSQL (uses the local postgres:16-alpine image)
npm run db:start

# 2. Create the backend environment file
npm run setup:env

# 3. Install backend dependencies
npm --prefix backend install

# 4. Generate the Prisma client
npm run prisma:generate

# 5. Start the API
npm run backend:dev
```

Verify the API and database connection:

```bash
curl http://localhost:4000/api/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "database": "connected",
    "uptimeSeconds": 1,
    "timestamp": "2026-11-09T00:00:00.000Z"
  }
}
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run db:start` | Start PostgreSQL in Docker |
| `npm run db:stop` | Stop PostgreSQL (data is kept) |
| `npm run db:logs` | Follow PostgreSQL logs |
| `npm run db:reset` | Stop PostgreSQL and delete its data volume |
| `npm run prisma:migrate` | Create/apply a development migration |
| `npm --prefix backend run prisma:studio` | Browse data in Prisma Studio |
| `npm run frontend:dev` | Start the Next.js dashboard on port 3000 |
| `npm run frontend:build` | Build the dashboard for production |
| `npm run frontend:start` | Serve the production dashboard build |
| `npm run test` | Run backend tests |

## Internal configuration

One source and one destination are configured through environment variables.
On startup the backend creates them if missing, or updates the existing rows.
Configuration is idempotent, so restarting does not create duplicates.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBHOOK_SOURCE_NAME` | `Postman Sandbox` | Display name of the source |
| `WEBHOOK_SOURCE_SLUG` | `postman-sandbox` | Stable source identifier used by the webhook URL |
| `WEBHOOK_SIGNATURE_HEADER` | `x-webhook-signature` | Header containing the HMAC signature |
| `WEBHOOK_SECRET` | — (required) | HMAC-SHA256 secret, minimum 16 characters |
| `DESTINATION_NAME` | `Local Mock Destination` | Display name of the destination |
| `DESTINATION_URL` | `http://localhost:4000/mock/success` | Single delivery endpoint |
| `DESTINATION_TIMEOUT_MS` | `10000` | Delivery timeout, 1000–30000 ms |

The secret is **never** written to PostgreSQL and never returned by an API. The
`source` row stores only `secretEnvVar = "WEBHOOK_SECRET"`.

Inspect the safe, internal configuration:

```bash
curl http://localhost:4000/api/config
```

```json
{
  "success": true,
  "data": {
    "source": {
      "id": "…",
      "name": "Postman Sandbox",
      "slug": "postman-sandbox",
      "signatureHeader": "x-webhook-signature",
      "isActive": true
    },
    "destination": {
      "id": "…",
      "name": "Local Mock Destination",
      "url": "http://localhost:4000/mock/success",
      "timeoutMs": 10000,
      "isActive": true
    },
    "webhook": {
      "signatureAlgorithm": "HMAC-SHA256",
      "signatureHeader": "x-webhook-signature",
      "signatureFormat": "sha256=<hex>"
    }
  }
}
```

Destination URLs are validated at startup: only `http`/`https` is allowed,
embedded credentials are rejected, and known metadata hosts are blocked.
Localhost is intentionally allowed because the mock destination runs on the
same Express backend.

## Mock destination endpoints

The backend exposes four local stand-ins at `/mock/*`, so `DESTINATION_URL` can
point at the relay itself. They are development helpers: they do not verify
signatures and are not part of the public ingestion API.

| Endpoint | Behavior | Useful for |
| --- | --- | --- |
| `POST /mock/success` | Always `200` | Happy path |
| `POST /mock/failure` | Always `500` | Retry and dead-letter |
| `POST /mock/timeout` | Holds the response for 35 s, longer than any allowed destination timeout | Timeout handling |
| `POST /mock/intermittent` | `503` on the first attempt per job, `200` on retries | Retry-then-recover |

Point the single destination at one of them, then restart the backend:

```dotenv
DESTINATION_URL=http://localhost:4000/mock/success
```

Each delivery sends JSON and these correlation headers:

- `x-webhook-event-id`
- `x-webhook-event-type`
- `x-webhook-delivery-job-id`
- `x-webhook-delivery-attempt`

Mock responses echo the mode and identifiers. The intermittent endpoint tracks
attempts by delivery job, so each distinct job fails exactly once and succeeds
on its first retry.

## Webhook ingestion

`POST /api/webhooks/:sourceSlug`

Example:

```bash
curl -X POST http://localhost:4000/api/webhooks/postman-sandbox \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=<hex hmac>" \
  -d '{"id":"evt_001","type":"payment.success","data":{"amount":2500,"currency":"USD"}}'
```

Payload contract:

```json
{
  "id": "evt_001",
  "type": "payment.success",
  "data": {
    "paymentId": "pay_123",
    "amount": 2500,
    "currency": "USD",
    "status": "succeeded"
  }
}
```

- `id` — external event ID (required, max 255 chars)
- `type` — event type (required, max 100 chars)
- the whole JSON object is stored in `events.payload` (JSONB)

The signature is HMAC-SHA256 over the **exact raw request body bytes**, sent as
`sha256=<hex>` in the source's configured header. Changing whitespace or
reformatting the JSON after signing invalidates it.

Generate a signature in bash:

```bash
BODY='{"id":"evt_001","type":"payment.success","data":{"amount":2500}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "whsec_test_2f7c9a1e5b8d4f6a9c0e3b7d1f5a8c2e" -hex | sed 's/^.* //')
curl -X POST http://localhost:4000/api/webhooks/postman-sandbox \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: sha256=$SIG" \
  -d "$BODY"
```

Postman pre-request script:

```js
const secret = "whsec_test_2f7c9a1e5b8d4f6a9c0e3b7d1f5a8c2e";
const signature = CryptoJS.HmacSHA256(pm.request.body.raw, secret)
  .toString(CryptoJS.enc.Hex);

pm.request.headers.upsert({
  key: "x-webhook-signature",
  value: `sha256=${signature}`,
});
```

Responses:

| Status | Meaning |
| --- | --- |
| `202` | New event stored |
| `200` | Duplicate event; returns the existing event with `duplicate: true` |
| `400` | Invalid JSON or missing/invalid `id` / `type` |
| `401` | Missing or invalid signature |
| `404` | Unknown or inactive source slug |
| `413` | Body exceeds 1 MB |
| `415` | Content-Type is not JSON |

Duplicate prevention is enforced by the unique
`events (sourceId, externalEventId)` constraint, so it also holds under
concurrent requests. A valid event and its delivery job are committed in one
Prisma transaction:

- event status: `queued`
- job status: `pending`
- `attemptCount`: `0`
- `maxAttempts`: `5`
- `nextAttemptAt`: immediately due

If either insert fails, both roll back. A duplicate request returns the existing
event and its existing job; it never creates a second job.

New event response:

```json
{
  "success": true,
  "data": {
    "eventId": "6f3d5dcf-763f-4e1b-8afc-5539d8bf897e",
    "externalEventId": "evt_001",
    "eventType": "payment.success",
    "status": "queued",
    "jobId": "f7ac08a5-790f-4456-92ed-9b0563287fb7",
    "deliveryStatus": "pending",
    "duplicate": false,
    "receivedAt": "2026-11-09T08:36:08.094Z"
  }
}
```

## Dashboard read APIs

The dashboard APIs are read-only. There are intentionally no replay, retry, or
destination-management endpoints.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/overview` | Aggregate counts for Overview |
| `GET` | `/api/events` | Paged event list |
| `GET` | `/api/events/:eventId` | Event detail with job, destination and attempt history |
| `GET` | `/api/deliveries` | Paged delivery-job list for Delivery Monitoring |
| `GET` | `/api/deliveries/:deliveryJobId` | Delivery detail with attempt history |
| `GET` | `/api/dead-letter` | Paged Failed Events / Dead Letter Queue |

Pagination is shared by the list endpoints:

- `limit` — integer `1`–`100`, default `25`
- `offset` — integer `>= 0`, default `0`
- response meta: `{ total, limit, offset, hasMore }`

Filters:

- Events: `status` (one or comma-separated), `eventType`, `search` (external
  event ID), `receivedFrom`, `receivedTo`. Newest `receivedAt` first.
- Deliveries: `status` (one or comma-separated), `eventType`, `search`,
  `updatedFrom`, `updatedTo`. Newest `updatedAt` first.
- Dead letter: `eventType`, `search`, `receivedFrom`, `receivedTo`. Newest
  failure first.

Example:

```bash
curl "http://localhost:4000/api/events?status=dead_letter&search=evt_&limit=25"
curl "http://localhost:4000/api/deliveries?status=retrying,processing"
curl "http://localhost:4000/api/dead-letter"
```

`/api/overview` returns zero-filled status counts, 24-hour volumes, attempt
outcomes, the succeeded/dead-letter success rate, and the active destination
count:

```json
{
  "success": true,
  "data": {
    "events": {
      "total": 5,
      "byStatus": {
        "received": 0,
        "queued": 2,
        "processing": 0,
        "delivered": 2,
        "dead_letter": 1
      },
      "last24Hours": 5
    },
    "deliveryJobs": {
      "total": 5,
      "byStatus": {
        "pending": 1,
        "processing": 0,
        "retrying": 1,
        "succeeded": 2,
        "dead_letter": 1
      },
      "successRate": 66.67
    },
    "attempts": {
      "total": 7,
      "byOutcome": {
        "succeeded": 2,
        "retryable_failure": 4,
        "permanent_failure": 1
      },
      "last24Hours": 7
    },
    "destinations": { "active": 1 },
    "generatedAt": "2026-11-09T10:32:22.707Z"
  }
}
```

Event lists omit the JSONB payload to keep responses small; the event detail and
delivery detail endpoints include it. Secrets, signatures and `secretEnvVar` are
never returned.

## Dashboard frontend

The Next.js App Router dashboard lives in `frontend/`. It is plain JavaScript
with plain CSS and reads only from the dashboard APIs above.

```bash
# One-time: install frontend dependencies
npm --prefix frontend install

# Start the backend first (port 4000), then:
npm run frontend:dev
```

Open <http://localhost:3000>. The browser calls relative `/api/*` URLs, and
`frontend/next.config.js` rewrites them to `http://localhost:4000/api/*`, so no
CORS configuration is needed. Set `BACKEND_URL` to rewrite to a different
backend origin.

The dashboard has exactly four sections, reachable from the top navigation:

| Section | Contents |
| --- | --- |
| Overview | Event, delivery-job and attempt totals, 24-hour volumes, status breakdowns and the delivery success rate |
| Events | Paged inbound event list with status, event-type and external-ID filters; opens a detail drawer |
| Delivery Monitoring | Paged delivery-job list with status, event-type and external-ID filters; attempt counts, retry schedule and last response |
| Failed Events / Dead Letter Queue | Permanent failures and jobs that exhausted their retries, with the last attempt outcome |

Filters are applied on submit; lists are paginated 25 rows at a time. Each row
has a `View` action that opens a read-only drawer with identifiers, timestamps,
destination details, the stored event payload and the full attempt history.

The UI is intentionally read-only: there are no replay, manual retry or
destination-management controls. Signatures and the HMAC secret are never
displayed.

Production build and serve:

```bash
npm run frontend:build
npm run frontend:start
```

The frontend scripts pass `--webpack` because Turbopack's native bindings are
blocked by the Application Control policy in this environment. On other
machines you can switch the scripts to plain `next dev` / `next build`.

## Database schema

Prisma schema: `backend/prisma/schema.prisma`
Applied migrations: `backend/prisma/migrations/`

| Table | Purpose |
| --- | --- |
| `sources` | Incoming webhook source configuration (header name, secret env-var name) |
| `events` | Verified incoming events, original JSONB payload, processing status |
| `destinations` | The single configured delivery endpoint |
| `delivery_jobs` | Persistent delivery state, attempts, retry schedule, lock + lock expiry, errors |
| `delivery_attempts` | One row per HTTP delivery attempt |

Key data rules:

- `events (sourceId, externalEventId)` is unique — this is the idempotency
  guarantee for duplicate webhook delivery.
- Each event has at most one delivery job (`delivery_jobs.eventId` is unique).
- Attempt numbers are unique per job.
- JSONB is used for `events.payload`.
- All timestamps use `TIMESTAMPTZ(3)`.
- Destination rows are handled as a single configured endpoint; the Phase 3
  service enforces that only one is used. There is no destination management
  or multi-destination routing.
- Source rows store `secretEnvVar`, not the secret. The HMAC secret stays in
  the environment (`WEBHOOK_SECRET`).

### Delivery processor

- Runs inside the existing Express process with `setInterval()` every 2 seconds
  and processes up to 5 jobs per tick.
- An in-process boolean prevents overlapping processor runs.
- On startup, any `processing` jobs left by a previous run are reset to
  `retrying`. On every tick, jobs whose `lockExpiresAt` has passed are also
  recovered.
- Jobs are claimed in a short transaction using parameterized
  `SELECT ... FOR UPDATE SKIP LOCKED`, then marked `processing` with `lockedAt`
  and a 30-second `lockExpiresAt`. The transaction commits before any HTTP
  request starts.
- Successful delivery marks the job `succeeded` and the event `delivered`.
- Failed delivery marks the job `retrying` with exponential backoff, or
  `dead_letter` when the failure is permanent or the maximum attempt count is
  reached.
- Delivery hardening: JSON `POST` with the destination timeout, no redirect
  following, response bodies always drained, timeout and network errors
  recorded with their cause (for example `ECONNREFUSED`), and attempt metadata
  sent in request headers.
- Every HTTP attempt writes one `delivery_attempts` row with its attempt
  number, request/response timestamps, status code, response time, error and
  outcome. The attempt insert and the job/event updates share one transaction.
- No database transaction is held open during HTTP delivery.

### Retry policy

| Result | Outcome | Action |
| --- | --- | --- |
| `2xx` | `succeeded` | Job `succeeded`, event `delivered` |
| `408`, `425`, `429`, any `5xx` | `retryable_failure` | Retry with backoff |
| Other `4xx` and `3xx` | `permanent_failure` | Dead-letter immediately |
| Timeout, DNS, connection reset/refused | `retryable_failure` | Retry with backoff |
| Invalid or inactive destination | `permanent_failure` | Dead-letter immediately |

Backoff is exponential from a 5-second base with equal jitter of 50–100% of the
exponential value:

```text
delay = min(5000 ms * 2^(attempt - 1), 5 min)
delay = delay / 2 + random(0, delay / 2)
```

A `Retry-After` header from the destination is honored when it requests a
longer wait. After the fifth attempt a retryable failure becomes `dead_letter`.
All attempt rows are kept for the delivery-monitoring and dead-letter views.

There is no outbox table and no separate worker.

## Build status

- [x] **Phase 1:** Project setup, folder structure, dependencies, local
      PostgreSQL connection
- [x] **Phase 2:** Database schema, tables, constraints, indexes, migrations
- [x] **Phase 3:** Backend configuration and source/destination setup
- [x] **Phase 4:** Webhook ingestion, HMAC verification, idempotency
- [x] **Phase 5:** Transactional event persistence and delivery job creation
- [x] **Phase 6:** Scheduled delivery processor and safe job claiming
- [x] **Phase 7:** HTTP delivery and mock destination testing
- [x] **Phase 8:** Retries, exponential backoff, attempt history
- [x] **Phase 9:** Dead letter queue and failed-event APIs
- [x] **Phase 10:** Next.js dashboard with four read-only sections
- [ ] Phase 11: Integration testing, error handling, documentation
