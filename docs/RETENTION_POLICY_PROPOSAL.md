# Data Retention Policy Proposal — Approval Required

**Status:** proposal only. No TTL indexes, scheduled deletion, archival job, or production data operation has been added. Retention periods require business/legal approval for the operating jurisdictions and contractual obligations.

| Record class | Proposed handling | Period |
|---|---|---|
| Payment, refund, journal/ledger, settlement, and payout records | Retain as financial records; append corrections/reversals; restrict access; include in encrypted backups and tested restore procedures. Never automatically delete. | To be set by accountable business/legal owner. |
| Operator audit logs | Append-only access, restricted access, integrity monitoring, preserve for investigations and required financial audit. No automatic deletion until policy and hold workflow are approved. | To be set by accountable business/legal owner. |
| Reconciliation runs and source/variance records | Keep run metadata, outcomes, and unresolved exceptions with linked financial references. Archive only with searchable retrieval and preserved integrity. Do not delete unresolved cases. | To be set by accountable business/legal owner. |
| Webhook delivery and attempt records | Preserve status, timestamps, endpoint/event references, response classification, and attempt count. Minimize or redact response bodies and avoid storing credentials. Archive completed records after an approved operational window; preserve unresolved/failed deliveries longer until resolved. | Operational window unresolved. |
| Provider event payloads | Minimize sensitive fields; restrict access; prefer retaining signature verification metadata and normalized event facts over full payload when replay needs permit. Any payload expiry must account for dispute/replay needs and legal holds. | Unresolved; do not add cleanup yet. |
| Background queue history | Redis/BullMQ history is operational and may be ephemeral; Mongo delivery/outbox/refund records remain durable source of truth. Set queue completed/failed job removal windows separately from business record retention and ensure jobs can be recovered before pruning. | Deployment-specific; verify current BullMQ/Redis policy. |
| Application/proxy logs | Avoid secrets and unnecessary personal data; restrict access and align rotation/retention across host, CDN, and observability vendors. | Provider settings not inspected or changed. |

## Required controls before implementing archival or cleanup

1. Name an owner and document applicable jurisdictions, contracts, dispute windows, tax/accounting obligations, and legal hold requirements.
2. Approve a duration and start event for each record class, plus exceptions for unresolved cases and fraud investigations.
3. Define archival encryption, access roles, retrieval time, integrity verification, backup coverage, and restore tests.
4. Define deletion approval, evidence/audit of deletion, and a dry-run report; exclude linked or unresolved records.
5. Confirm database backups, provider logs, Redis persistence, and third-party retention settings separately.

Until those choices are approved, retain records and do not introduce automatic deletion or TTL expiration for financial, audit, reconciliation, outbox, or delivery records.
