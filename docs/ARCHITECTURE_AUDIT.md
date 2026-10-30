# PayOps Architecture Audit

**Inspection date:** 2026-10-30
**Scope:** repository inspection and the approved Stage 3 implementation. See `IMPLEMENTATION_CHANGELOG.md` and `TESTING_RESULTS.md` for exact edits and checks.

## System map

- `client/`: React 18 / Vite dashboard. `src/api.js` centralizes API access; `src/auth.jsx` manages dashboard auth; pages cover payment operations, checkout, webhooks, ledger, settlement, reconciliation, and developer setup.
- `server/src/app.js`: Express app composition and middleware. `routes/` separates merchant API (`v1.js`), dashboard (`dashboard.js`), checkout, provider webhooks, and development routes.
- `server/src/services/`: payment, refund, ledger, provider-event, webhook/outbox, settlement, reconciliation, risk, and monitoring workflows. Mongoose models live in `server/src/models/`; domain invariants and shared utilities are under `domain/` and `lib/`.
- `server/src/worker.js`, `queues/`, and `jobs/`: BullMQ background work using Redis. MongoDB is the durable application record; Redis is used for queue/cache delivery.
- `sdk/`: zero-dependency Node client. `docs/`, root README, and deployment guides describe use and operation.
- Runtime choices: Docker Compose provides MongoDB configured as a single-node replica set, Redis, API, worker, and Nginx dashboard. Render's free demo topology runs worker work with the API and uses free Key Value; Vercel serves the client separately.

## Lifecycle outline

1. Merchant API requests authenticate with scoped API keys and validate request data.
2. Payment and provider state changes are handled by services; transactional MongoDB work maintains payment/ledger/outbox consistency.
3. Provider webhooks are signature-checked and deduplicated through durable provider-event records, then processed asynchronously.
4. Refunds reserve amounts and retain ambiguous provider outcomes for operator reconciliation.
5. Outbox events fan out to merchant webhook delivery records and BullMQ jobs.
6. Settlement is explicitly a simulated ledger sweep; it does not initiate a bank/provider payout.

## Architecture observations

- Business logic is largely separated into services/domain helpers, but the dashboard and merchant route modules remain orchestration-heavy. Consider extracting route-specific validation/serialization only when a concrete testability or maintenance benefit is demonstrated.
- MongoDB remains the source of truth for webhook delivery state. The worker now periodically scans pending/retrying records and stale processing leases, checks active BullMQ jobs, and re-enqueues missing work with stable delivery IDs. A Mongo lease prevents concurrent handlers from processing the same delivery. Delivery remains at-least-once across a crash after remote acceptance; consumers should deduplicate by event ID.
- `client/nginx.conf` now proxies `/api/` and `/v1/` to the API and `/health/live` for container health. API locations precede SPA fallback. Application and proxy access logs omit query values.
- Production/demo topology and durability differ: local Compose uses Redis AOF and separate API/worker; Render free demo uses nonpersistent free Key Value and in-process workers. Document this as a demo limitation, not a production-grade queue guarantee.
- Reconciliation is a useful basic comparison, not full settlement reconciliation: current design does not establish settlement-file matching, duplicate provider transaction reporting, or fee variance matching.
- Settlement review found the simulator sweeps the merchant's full ledger balances when any mature payment qualifies, while associating only mature captured payments with the settlement record. This can attribute newer payment balances to a settlement early; allocation semantics need a specific accounting/product decision and were not changed in this batch.

## Current scope limits

Settlement records are simulated. Reconciliation is basic. Public registration and deterministic local demo seeding are suitable only with deployment-specific access controls and seed hygiene. These limits must be explicit in product and deployment claims.
