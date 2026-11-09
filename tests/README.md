# Tests

Run the backend test suite from the project root:

```bash
npm test
```

This delegates to `npm --prefix backend test`, which runs Node's built-in test
runner over:

- `unit.test.js` — retry policy, backoff jitter, Retry-After parsing and HMAC
  verification.
- `integration.test.js` — HTTP ingestion, validation, delivery processing,
  dashboard APIs and error responses against the real Express app.

## Test database

Integration tests never use the developer database. The helper in
`helpers/testDatabase.js`:

1. Connects to the PostgreSQL server from `backend/.env`.
2. Creates `payment_relay_test` if it does not exist.
3. Applies all Prisma migrations to it with `prisma migrate deploy`.

The test process then truncates the test tables before each test. The test
database is left in place for the next run, so the first run is slightly slower
than later ones.

PostgreSQL must be running (`npm run db:start`) and `backend/.env` must exist
(`npm run setup:env`). The tests use a fixed, non-production HMAC secret and
their own source/destination rows.
