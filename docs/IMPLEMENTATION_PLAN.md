# PayOps Audit Remediation Plan

Stage 1 inspection is complete. Stage 3 was committed at `d79fd1762830686b3e62518e8662c031784726bd` before this Stage 4 review. Stage 4 changes are local and uncommitted. See `IMPLEMENTATION_CHANGELOG.md`; unresolved settlement/retention policy work remains gated below.

## Batch 1 — secret exposure and durable delivery recovery

1. New checkout links use fragments and authorization headers; old query links remain compatible. App and Nginx logs omit query values; expiry is enforced on reads and confirmations.
2. Mongo-backed delivery recovery, stable job identifiers, processing leases, and periodic worker scheduling are implemented.
3. Focused and Mongo/Redis integration tests cover link shape, log redaction, job loss/recovery, duplicate claims, checkout expiry, and refund reservation concurrency.

## Batch 2 — environment and deployment correctness

1. Nginx `/v1` and liveness routes are implemented; config assertions and an isolated stub-API smoke test pass. The pre-existing application API returned 502 because its Mongo dependency was unavailable; its containers were not restarted or changed.
2. A dashboard container health check probes `/health/live` through Nginx.
3. Render free-tier configuration, external resource names, database name, and secrets remain unchanged.

## Batch 3 — lifecycle and operator controls

1. Define operational/audit data retention and PII minimization without deleting historical records.
2. Demo seeding now refuses to run in production.
3. Evaluate dashboard token storage and CSP/XSS defense-in-depth.
4. Expand reconciliation and settlement allocation only after requirements and provider data sources are defined.
5. Keep settlement labeled simulated until an actual payout integration and reconciliation lifecycle exist.

## Batch 4 — maintainability and documentation

1. `docs/SECURITY_AUDIT.md` now supersedes stale root security claims; the root report was preserved as historical material.
2. Add client lint/unit coverage where it protects real UI/API contracts; no lint script is currently configured.
3. Review third-party inspiration and license notices; preserve provenance claims accurately.

## Gate for each batch

Review a small diff, run focused regression tests, then run the repository CI-equivalent checks. Do not commit, push, deploy, rotate credentials, change hosted resources, or rewrite Git history as part of these implementation batches unless separately requested.

## Unresolved financial correctness issue

Settlement simulation may sweep balances associated with newer, not-yet-mature payments when an older payment triggers a run, while the settlement record links only mature payments. Correcting this requires a decision on allocation and refund netting; it is documented rather than silently changing settlement semantics. Obtain explicit scope approval before changing that accounting behavior.

## Stage 4 status and approval gates

1. Settlement allocation design and required regression scenarios are in `SETTLEMENT_ALLOCATION_DESIGN.md`. No settlement implementation changed. Obtain decisions on maturity, full/partial allocation, refund netting, fees, and whether simulated payout remains in scope before implementation.
2. `JournalEntry` Mongoose middleware now blocks ordinary updates, replacements, and deletes while retaining inserts. Database-native access is not covered. A least-privilege MongoDB role requires a separate credential/operations review and explicit approval before deployment changes.
3. Checkout's internal seed consumer migrated to Authorization; the browser strips capability URLs before paint and sets no-referrer policy. Backend query fallback remains until direct external consumers are confirmed migrated.
4. `RETENTION_POLICY_PROPOSAL.md` lists record classes and safe controls. No duration was invented and no archive/deletion code was added; approve periods, jurisdictions, holds, and ownership first.
