# PayOps Module 1 — Functional Completion Audit

**Review date:** 2026-10-30
**Reviewed baseline:** `f9d182a68d686f3b23623e3ccf00e63eb177b5dc`
**Product scope:** simulated payment operations and reliability demo. No real-money processing or bank payouts.

Status meanings: **Working** means supported by code review and existing automated coverage; **Partially working** means an identified limitation remains; **Missing** means no implementation was found; **Intentionally deferred** means outside this module's agreed product or policy scope.

## Feature status

| Area | Status | Evidence and limitation |
|---|---|---|
| Payment creation, validation, state transitions, detail/history | Working | Merchant API and dashboard routes use shared payment services, validators, and state machine. Backend tests cover lifecycle and state transition behavior. |
| Idempotent payment creation | Working | Durable MongoDB idempotency records are authoritative; Redis is a fast path. Same-key/different-payload and in-flight conflicts are handled. Covered by backend tests. |
| Refund simulation | Working | Partial refunds, concurrent amount reservations, retries, and ambiguous outcomes are handled by the simulated provider flow. No real refund is sent. |
| Double-entry ledger | Working with limitation | Integer-paise debit/credit entries are transactionally posted and app-level mutation paths are guarded. Direct MongoDB/native collection or privileged admin access can bypass Mongoose middleware; the production DB role is not verified. |
| Webhook events, delivery, retry, recovery | Working for defined events | Outbox and Mongo delivery state support retries, leases, idempotent claims, and missing-job recovery. Delivery is at-least-once. Event types are transition-focused; creation events are not part of the current event vocabulary. |
| Frontend/API integration | Working with limitation | Dashboard pages call corresponding API resources and route paths align with proxy configuration. Initial loading states are now explicit. No browser E2E suite is configured, so visual interaction coverage is limited to build and code review. |
| Dashboard metrics | Partially working | Metrics are sourced from ledger/payment data. Success rate is a capture rate among captured or failed payments created in the period; settlement payout/allocation totals have a documented attribution limitation. UI wording identifies these as simulated figures. |
| Settlement simulation | Partially working | Simulated settlement sweeps ledger balances when eligible payments mature, but does not allocate every swept amount to eligible payments. Do not claim complete settlement reconciliation. Allocation redesign requires business-policy approval. |
| Provider reconciliation | Partially working | Compares simulated provider payment records with PayOps records and checks ledger balance. This is not bank reconciliation and does not prove settlement allocation correctness. |
| Checkout capability security | Working with migration limitation | New links place capabilities in URL fragments; browser code migrates capability to an Authorization header and removes it from the visible URL. Query fallback remains for legacy direct API consumers and should be removed only after migration confirmation. |
| Redis/BullMQ reliability | Working with deployment limitation | MongoDB outbox/delivery state can recover missing queue jobs and stale claims. Redis is an execution queue, not the durable record. A free/non-persistent Redis service can lose queue state and is suitable only for a demo. |
| Production demo seed safeguards | Working | Seed path is restricted in production and regression-tested. |
| Real payment processing, real bank payouts, KYC/AML, production settlement allocation | Intentionally deferred | Conflicts with the educational/demo product decision. |
| Financial/audit retention cleanup | Intentionally deferred | No automatic cleanup is implemented. A retention period and jurisdictional/business approval are still required. |
| Browser end-to-end suite | Missing | No browser automation harness is configured. Frontend production build does not replace interactive browser testing. |

## Module 1 scope corrections

The current UI now shows loading feedback on overview, ledger, settlement, reconciliation, webhook, and developer-key views. Dashboard balances and reconciliation language describe simulated/provider data accurately. Webhook delivery success displays the HTTP status without labeling every successful status as `OK`.

No settlement allocation behavior, payment rules, database schema, credentials, deployment resource, or production setting was changed. The pre-existing untracked root `package-lock.json` is preserved and excluded from this work.

## Module 2 handoff

1. Add a browser E2E harness and exercise login, payment creation/detail, refunds, webhook endpoint/delivery inspection, ledger, and error/loading/empty states against isolated services.
2. Decide the settlement eligibility, maturity, fee, partial allocation, failure, and correction policies before implementing allocation records.
3. Confirm the supported-consumer migration window before removing legacy checkout query-token support.
4. Set an approved retention policy before implementing archival or cleanup.
5. If operated beyond a demo, configure durable Redis and a MongoDB role that restricts direct modification of posted ledger records; verify via a dedicated isolated role test.
