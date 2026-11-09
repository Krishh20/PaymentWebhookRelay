# Payment Webhook Relay — Dashboard

Read-only Next.js dashboard for the Mini Payment Webhook Relay backend.
Built with the App Router, React 19, plain JavaScript and plain CSS.

## Run

Install dependencies once:

```bash
npm install
```

With the backend running on `http://localhost:4000` and PostgreSQL started from
the project root:

```bash
npm run dev
```

Open <http://localhost:3000>.

Relative `/api/*` requests are rewritten to the backend by `next.config.js`, so
the browser never makes a cross-origin request. Override the target with the
`BACKEND_URL` environment variable.

Production build:

```bash
npm run build
npm start
```

The `dev` and `build` scripts use `--webpack` because Turbopack's native
bindings are blocked by the Application Control policy in this environment.

## Sections

The dashboard has exactly four sections:

1. **Overview** — event, delivery-job and attempt totals, 24-hour volumes,
   status breakdowns and the delivery success rate.
2. **Events** — paged inbound event list with status, event-type and external-ID
   filters. Opens a detail drawer with the payload, job state and attempt
   history.
3. **Delivery Monitoring** — paged delivery-job list with status, event-type
   and external-ID filters, attempt counts, next attempt time and the latest
   destination response.
4. **Failed Events / Dead Letter Queue** — permanent failures and jobs that
   exhausted their retries, including the last attempt outcome and error.

## Behavior

- Filters apply on submit and reset the list to the first page.
- Lists are paginated at 25 rows per page.
- Detail drawers are view-only and close with the close button or `Escape`.
- There are no replay, manual retry or destination-management controls.
- Signatures, `secretEnvVar` and the HMAC secret are never displayed.

## Layout

```text
app/
├── globals.css   # full dashboard styling and responsive rules
├── layout.js     # root layout
└── page.js       # shell, section navigation, detail drawer state
components/
├── OverviewSection.js
├── EventsSection.js
├── DeliveriesSection.js
├── DeadLetterSection.js
├── DetailDrawer.js
└── ui.js         # shared badges, banners, pagination, loading/empty states
lib/
├── api.js        # fetch helper and query-string builder
└── format.js     # date, number and percentage formatting
```

All data comes from the read-only backend endpoints documented in the root
`README.md`: `/api/overview`, `/api/events`, `/api/events/:id`,
`/api/deliveries`, `/api/deliveries/:id` and `/api/dead-letter`.
