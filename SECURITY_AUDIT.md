# PayOps Security Audit

**Audit date:** 2026-10-30
**Scope:** repository configuration and application code; targeted unit tests and dependency advisories. No live payment credentials, payment traffic, or production deployment were used.

## Architecture and payment lifecycle

The React/Vite dashboard calls the Express API. Merchants authenticate with JWTs in the dashboard and API keys for the public payments API. MongoDB stores merchants, payments, provider events, refunds, ledger entries, settlements, and webhook delivery state. Redis/BullMQ runs payment, refund, webhook, and maintenance jobs.

The payment flow creates a provider order and a PayOps payment record, then serves a checkout link containing a payment-scoped client secret. Checkout confirmation starts processing. Provider webhooks are signature-verified and durably deduplicated before workers update payment state. Capture, ledger posting, and outbox creation use MongoDB transactions. Workers deliver merchant webhooks, process refunds, settle captured payments, and reconcile provider records.

## Findings and remediation

### High — outbound webhook destinations could reach private networks — fixed

**Evidence:** `server/src/services/webhookService.js` originally checked only a small set of literal hostname prefixes. A public hostname resolving to RFC1918, loopback, link-local, or reserved IP space passed that check.

**Impact:** an authenticated merchant could configure an outbound webhook that targeted internal services or cloud metadata endpoints.

**Change:** production endpoint creation resolves all DNS answers and rejects private or reserved addresses. The HTTP(S) socket performs the same validation during connection lookup, preventing a changed DNS answer from bypassing the initial check. Production also requires HTTPS. The development exception is unavailable in production.

### High — refund retries could repeat a provider-side refund — mitigated

**Evidence:** `server/src/services/refundService.js` invokes the provider before committing the successful refund state. A timeout or process failure can leave the provider outcome unknown. Previously, exhaustion of retries marked the refund failed and released its reserved amount.

**Impact:** an accepted refund with a lost response could be repeated, or the amount could be made available for a second refund.

**Change:** the Razorpay adapter sends a stable `X-Refund-Idempotency` key and stable request data using the PayOps refund ID. If retries exhaust with an unknown outcome (network failure, 5xx, or 409), the refund remains pending, retains its reservation, and is flagged for reconciliation. The mock provider identifies its simulated pre-processing failures as definitive rejections.

**Remaining control:** an operator must reconcile a refund left in `needs_attention` with the provider before retrying or releasing its reserved amount. No automated resolution workflow exists yet.

### High — vulnerable dependency versions — fixed

Initial `npm audit` found high-severity advisories affecting Vite, `body-parser`, and Zod.

- Client Vite was upgraded to the patched 6.4 line.
- Server Zod was upgraded to the patched 4.6 line.
- The server pins compatible `body-parser` 1.20.9 through npm overrides.

Post-change npm audits report no high-severity advisories. The client retains two moderate React Router advisories; see residual risks.

### Medium — development routes and known mock-bank secret accepted in production — fixed

**Evidence:** the Render Blueprint enabled `ENABLE_DEV_ROUTES`, and production configuration accepted the default mock-bank webhook secret.

**Impact:** development endpoints were exposed, private webhook destinations were permitted, and the mock provider used a predictable signing secret.

**Change:** Render now disables development routes and generates `MOCKBANK_WEBHOOK_SECRET`. Startup validation rejects development routes in production and rejects the known or short mock-bank secret when mockbank is selected.

### Medium — populated sensitive values were present in the tracked environment template — sanitized

**Evidence:** the working copy of `server/.env.example` contained populated MongoDB and secret fields. Their values are intentionally not recorded here.

**Change:** the template now contains placeholders only.

**Action:** if any removed value was a real credential, rotate it. If it was ever pushed to a remote repository, treat it as exposed and rotate it even if the current file has been cleaned.

## Residual risks and verification limits

- `react-router-dom` remains on v6 and npm reports two moderate advisories in its dependency. The dashboard uses internal navigation targets; the SSR hydration advisory is not applicable to this client-only Vite app. Reassess before passing untrusted strings to router navigation, or schedule a tested v7 migration.
- Merchant registration is public by design. A public production service should add an invitation/approval policy or abuse controls appropriate to its intended audience.
- The test suite exercises pure logic and targeted regressions; it does not run a MongoDB replica set, Redis, BullMQ workers, or an end-to-end provider integration. Those runtime paths still need staging verification.
- Atlas access policy, backups/restore, Render/Vercel URLs, and live provider webhook configuration are deployment-owner actions and were not verified against hosted accounts.
- This review is not a penetration test or compliance assessment. It does not establish PCI DSS compliance or certify production safety.

## Verification

- Server unit tests: 7 suites, 47 tests passed.
- Client production build: passed with Vite 6.4.5.
- JavaScript syntax checks and `git diff --check`: passed.
- Post-upgrade npm audit: zero high-severity advisories; two moderate client advisories and six low server advisories remain.
- No lint script is configured in the package manifests.
