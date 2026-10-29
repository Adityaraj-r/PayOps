# PayOps operations guide

## Simulated settlements

The settlement worker writes balanced ledger entries that model provider settlement and merchant payout. It does not call a bank, Razorpay, or another payout service. A settlement with status `paid` is a simulator status only and is not evidence of a funds transfer. Keep this feature in demo/test use until a real payout provider, transfer idempotency, status lifecycle, and settlement reconciliation are implemented and tested.

## Platform reconciliation access

Set `PLATFORM_ADMIN_EMAILS` in the API environment to a comma-separated allowlist of registered account emails. The comparison is case-insensitive and whitespace-trimmed. Only authenticated allowlisted accounts can manually trigger the platform-wide reconciliation run. Keep the allowlist small and remove access when an operator leaves. Scheduled worker runs do not use this HTTP authorization path.

Merchant reconciliation responses contain only that merchant's issue rows, issue counts, matched count, and ledger check. Existing reports created before merchant-scoped counts were added show “not recorded” for the matched count; new scheduled reports will include it.

## Secrets and rotation

- Generate `JWT_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` and store it in the deployment secret manager. Replacing it invalidates all current dashboard tokens; coordinate the change and have users sign in again.
- Generate `WEBHOOK_SECRET_ENCRYPTION_KEY` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. It must be unique per environment and backed up through the secret manager. Losing or replacing it without re-encrypting webhook secrets makes those secrets unreadable.
- Set the encryption key before deploying this code. Existing plaintext endpoint secrets remain readable during migration. Run `npm run encrypt:webhook-secrets` from `server` first to preview the count, then run `npm run encrypt:webhook-secrets -- --apply` to encrypt them. The command never prints secret values.
- New webhook secrets are encrypted at rest and shown only when created or rotated. The old reveal route now returns a conflict; use `POST /api/dashboard/webhooks/endpoints/:id/rotate`. The previous secret is accepted for 24 hours and is sent in the `payops-signature-previous` header during that overlap. After the overlap, only the new secret is sent.

## Ambiguous refund resolution

Only an allowlisted platform operator can call these dashboard API routes. They require the operator's normal dashboard bearer token.

1. `GET /api/dashboard/refunds/attention` lists pending refunds that need review.
2. `POST /api/dashboard/refunds/:id/check` with `{"reason":"Provider timeout; checking status"}` queries the configured provider and appends a durable operator audit entry.
3. Within five minutes, `POST /api/dashboard/refunds/:id/resolve` may use one of:
   - `{"action":"mark_succeeded","reason":"Provider confirms processed refund"}` only when provider status is succeeded.
   - `{"action":"mark_failed","reason":"Provider confirms failed refund"}` only when provider status is failed; this releases the reserved amount transactionally.
   - `{"action":"retry","reason":"Provider confirms no matching refund"}` only when a complete provider lookup confirms no matching refund. Retry uses the original refund identity and is queued durably.

Pending or unknown provider results cannot be marked failed or retried. Check again after the provider has had time to settle an in-flight result. Each check and resolution records operator account ID/email, timestamp, reason, prior/resulting state, and provider status. Never edit refund or ledger documents directly to resolve a case.

## Production operation prerequisites

- Set a unique `PLATFORM_ADMIN_EMAILS` allowlist and strong JWT, mock-bank, and provider credentials through the deployment secret manager.
- Monitor `refunds` job age and failures, refunds with `needsAttention`, webhook dead letters, provider-event orphans, and reconciliation mismatches.
- Back up MongoDB and Redis according to their roles. MongoDB contains the accounting and operation records; Redis is a recoverable queue/cache layer. Periodically restore MongoDB to an isolated environment and verify ledger integrity before relying on the backup.
- Probe `/health/live` for process liveness and `/health/ready` for MongoDB/Redis readiness. The worker emits structured `Operational alert:` logs for queue age/failures, stuck refunds, and stale/issue-bearing reconciliation reports. Configure the host log alerting to notify the on-call operator when these messages occur.
- The repository does not verify a live backup, hosted secret, provider account, or transfer integration. Those remain deployment-owner checks.
