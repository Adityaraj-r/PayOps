# PayOps Security and Reliability Audit

**Audit date:** 2026-10-30
**Scope:** static code/configuration review and Stage 3 changes. No live credentials or production traffic were used. This is not a penetration test.

## Controls observed

- Merchant API keys are random and stored as hashes; dashboard auth uses expiring JWTs and password hashing.
- Routes validate inputs and merchant scope; production rate limiting fails closed.
- MongoDB transactions and unique indexes support payment/ledger idempotency. Ambiguous refunds retain reservations for operator review.
- Provider webhook signatures and deduplication are implemented. Outbound webhook destinations are checked against reserved/private addresses at registration and connection time; production requires HTTPS.
- Webhook endpoint secrets are encrypted at rest. Helmet, constrained CORS, request limits, environment validation, health/readiness endpoints, and operational monitoring are present.

## Findings and changes

### High — checkout capability in query strings — mitigated for new links

**Previous issue:** generated checkout URLs and frontend API requests put the secret in query values, which URL logging can retain.
**Change:** new links put the capability in a URL fragment; browser code reads it, removes it from the visible URL, and sends it in an `Authorization: Checkout ...` header. The browser accepts already-issued `?secret=...` checkout page links and migrates the credential before API calls. The backend prefers header auth but retains query fallback for direct clients during migration. App logs redact authorization and omit query strings; Nginx access logs use `$uri`, not `$request`, and omit Referer. Existing query links initially reach the dashboard host with the secret, so external CDN/host logs may already contain legacy tokens.
**Expiry/replay:** expiry is enforced for reads and confirmation. Existing payment-state transitions make repeated confirmation of a non-created payment idempotent. Tokens remain reusable until expiry and the Payment record still stores them in plaintext; token hashing/rotation remains future work.
**Residual proxy risk:** Nginx's built-in error log includes the original request target in upstream connection errors. A failed-upstream smoke check exposed a synthetic query marker in that error log even though the access log omitted it. Current generated links do not send capabilities in API queries, and the old browser page link is read/migrated before API calls; direct legacy API clients using query fallback may still expose the value in proxy error logs if the upstream fails. Remove query fallback after those clients migrate, and do not use it in new integrations.

### High — pending webhook delivery recovery — implemented

**Previous issue:** durable pending deliveries could be stranded after Redis lost jobs once their outbox event was published.
**Change:** a bounded scan recovers pending/retrying records and stale processing leases, skips active BullMQ jobs, removes stale terminal jobs, and re-enqueues work with stable delivery IDs. Atomic Mongo lease acquisition prevents concurrent handlers from both sending the same delivery. Outbox publication remains after delivery records/jobs are safely persisted. Integration tests for missing-job/restart recovery and concurrent claims passed against disposable MongoDB/Redis services.
**Limit:** delivery is at-least-once if a process crashes after remote acceptance and before recording success. Receivers should deduplicate by event ID.

### Medium — Docker `/v1` proxy — implemented

Nginx proxies `/api/` and `/v1/` without rewriting paths, forwards Host and X-Forwarded headers, and places API locations before SPA fallback. `/health/live` is proxied for the dashboard container health check. Static config tests and an isolated runtime smoke through a stub API passed; paths were preserved and `/` served the SPA. The existing application API returned 502 because its Mongo dependency was stopped; those containers were not restarted or changed.

### Medium — stale root audit

The root `SECURITY_AUDIT.md` contains obsolete dependency/test details. This document is current for this implementation; the root report was left unchanged as historical material and should be marked superseded in a separately reviewed docs-only change.

### Medium — retention and data minimization remain undefined

Provider events retain raw payloads, while outbox, delivery, reconciliation, attempt, and operator audit records accumulate. No records or TTL policies were added/deleted in this implementation. Define legal/business retention, access, backup, and deletion rules before any cleanup; accounting and audit records must not be deleted without an approved policy.

### Medium — dashboard bearer token in localStorage

`client/src/api.js` stores dashboard tokens in localStorage, exposing them to successful same-origin script injection. No XSS was established. Review CSP/output safety and a cookie-based design as defense in depth.

### Low / operational — demo seeding

The demo seed now exits before making requests when `NODE_ENV=production`. Demo credentials remain suitable only for local/test use; deployment owners must ensure public deployments are not seeded with demo accounts.

## Financial correctness review

Ledger posting templates validate positive integer lines and equal debits/credits; model validation repeats the invariant. Payment transitions reject backwards state movement. Refund reservation/finalization uses transactional conditional updates. Tests passed for ledger balance, lifecycle, duplicate idempotency, and concurrent distinct-key refund reservations staying within the captured amount. Journal entries are documented as append-only but database-level update/delete immutability is not enforced; an operator reversal/correction path should be defined before treating the ledger as tamper-resistant.

Settlement remains simulated. Review found it can sweep the merchant's full ledger balances when any mature payment qualifies, while linking only mature payments in the settlement record. This may attribute balances from newer payments to an earlier settlement. The allocation/netting policy needs a separate explicit accounting decision; no behavior was changed here. Reconciliation remains basic and lacks settlement-file matching, fee variance, and duplicate provider transaction reporting.

## Verification limits

See `TESTING_RESULTS.md` for commands/results. The repository has no lint script. No historical operational/audit records were deleted and no retention policy was introduced. The Render free-tier setup and hosted environment were not changed or deployed.
