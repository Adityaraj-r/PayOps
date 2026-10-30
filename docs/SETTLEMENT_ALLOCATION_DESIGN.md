# Settlement Allocation Design — Approval Required

**Status:** design only; settlement code is unchanged. This document deliberately does not choose unresolved commercial/accounting policy.

## Defect and invariant

`settlementService` currently selects mature payments for its descriptive record, but posts the merchant's full `provider_receivable` and `merchant_payable` ledger balances. Those balances can include activity from payments outside the selected set. A settlement can therefore sweep value that its `paymentIds`, gross, fee, and refund fields do not explain.

Required invariant: every amount moved by a settlement must be supported by explicit, immutable source allocations and fee records in the same currency. No account-wide balance sweep may substitute for source-level eligibility.

## Proposed allocation model

Introduce append-only allocation records linked to a settlement and a source activity. A capture allocation references one captured payment and records allocated gross, the payment's recorded fee, provider-settled amount, and merchant payable amount. A refund allocation references one succeeded refund and records its amount and any fee adjustment. Store currency and source timestamps. A unique source-allocation identity prevents replay of the same full allocation; partial allocation requires a deterministic allocation sequence or reservation identity and an aggregate cap enforced transactionally.

Settlement totals are derived only from allocations:

- `gross` = sum of allocated capture gross.
- `fees` = sum of the fee amounts attached to allocated capture activity, adjusted only by an explicit fee reversal policy.
- `refunds` = sum of allocated succeeded refund amounts.
- `providerSettled` = allocated captured gross less provider-side refunds, if and only if the provider settlement semantics confirm that interpretation.
- `payout` = allocated merchant payable less allocated refunds and fee adjustments. It must not be inferred from the merchant's whole ledger balance.

All amounts remain integer minor units. Enforce `gross = fees + payout + other explicitly named deductions` for each settlement. Persist the detailed components, rather than relying on a total that cannot be reconstructed.

## Eligibility and maturity proposal

Candidate captures must belong to the merchant, be captured, have no prior full allocation, have positive unallocated value, and be in the settlement currency. Refunds are eligible only after a terminal succeeded state; pending or ambiguous refunds are excluded and continue to reserve payment capacity under existing refund rules. A failed payment is never eligible. The settlement cutoff must be passed to the operation as a fixed timestamp and recorded.

Proposed maturity rule: capture activity matures at `capturedAt + settlementDelay`; a succeeded refund matures at `succeededAt + settlementDelay`. Boundary behavior should be inclusive at `maturesAt <= cutoff`. This avoids treating a newly captured payment as old merely because a separate older payment is ready. **Owner decision required:** confirm the maturity rule, delay, cutoff timezone/clock source, and whether refunds net against a later settlement or require a separate adjustment settlement.

## Partial allocations and duplicate prevention

The safest initial release should allocate a payment/refund source in full or leave it untouched. Partial settlement adds materially more reservation and correction states. If partial allocation is required, allocations must be immutable slices with a transactionally enforced ceiling: sum of successful and reserved slices cannot exceed the source's allocatable amount. Concurrent workers must use a conditional reservation/CAS and unique idempotency key, not read-then-write sums outside a transaction.

Create a settlement idempotency key scoped to merchant + cutoff/window + currency, with a unique index. In one Mongo transaction: claim eligible source amounts; insert the pending settlement and immutable allocations; post balanced ledger entries; and persist an outbox event. A duplicate request returns the prior settlement. If any step fails, all Mongo writes roll back. Keep external payout calls outside Mongo transactions and dispatch through an outbox.

## Failure, reversal, and correction

The current implementation simulates settlement and has no bank payout provider, so `paid` describes a simulation outcome rather than confirmed external money movement. A future real-payout flow needs explicit `pending`, `submitted`, `paid`, `failed`, and `unknown/review` states, provider idempotency, attempt records, and reconciliation for ambiguous timeouts. Do not post a final payout ledger entry until external success is confirmed. Failed attempts must release reservations only when failure is definitive; ambiguous outcomes remain held for reconciliation.

Never edit a posted settlement, allocation, or journal entry to correct it. Post a balanced reversal/adjustment referencing the original settlement/allocation, then create a corrected settlement with a new idempotency identity. Preserve original records and audit the actor/reason.

## Test scenarios required before implementation

1. Mature and immature captures coexist; only mature allocations affect totals or ledger postings.
2. A payment exactly at cutoff follows the agreed inclusive/exclusive rule; one just after it does not allocate.
3. Explicit allocations sum exactly to recorded gross, fees, refunds, provider amount, and payout.
4. Failed, created, pending, expired, and ambiguous refund activity is excluded.
5. Repeating the same settlement request returns the same settlement and creates no extra ledger entry.
6. Two concurrent settlement workers cannot allocate the same source value twice.
7. A full allocation cannot be selected again; partial allocation (if approved) cannot exceed remaining value across concurrent attempts.
8. A post-capture succeeded refund is handled according to the approved netting/adjustment policy.
9. A forced insert/post/outbox failure rolls back all transactional writes.
10. Definitive payout failure and ambiguous timeout follow distinct reservation/reconciliation paths.
11. Reversal/correction adds balanced entries and leaves original settlement/allocation records intact.
12. Existing ledger integrity and refund concurrency tests continue to pass.

## Decisions needed before implementation

Please approve or specify: (a) maturity delay and exact cutoff semantics; (b) full-only versus partial settlement; (c) refund netting timing; (d) who bears fees and how fee reversals work; (e) whether the simulated settlement remains the target or a real payout state machine is in scope. Implementation is intentionally paused until these business-policy choices are confirmed.
