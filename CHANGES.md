# Security hardening changes

## Application changes

- Hardened outbound webhook validation in `server/src/services/webhookService.js`: production resolves DNS destinations at endpoint creation and connection time, blocks private/reserved address ranges, rejects unsafe destinations, and requires HTTPS.
- Hardened production startup in `server/src/config/env.js`: dev routes are prohibited and mockbank requires a unique secret of at least 32 characters.
- Changed Render configuration in `render.yaml` to disable dev routes and generate the mock-bank webhook secret. The local Docker Compose profile now runs in development mode so its demo routes remain available without violating production checks.
- Added stable Razorpay refund idempotency via `X-Refund-Idempotency` in `server/src/providers/razorpay.js`.
- Changed exhausted ambiguous refund errors to remain pending, retain their reserved amount, and require reconciliation. Definitive rejections continue through the existing failed-refund flow.
- Replaced sensitive values in `server/.env.example` with placeholders.

## Dependency changes

- Upgraded client Vite to the patched 6.4 line.
- Upgraded server Zod to the patched 4.6 line.
- Added a compatible `body-parser` override at 1.20.9.
- Updated the client and server lockfiles.

## Regression coverage

- Added SSRF address classification, mixed DNS answer, and production configuration tests.
- Added Razorpay refund idempotency header coverage.
- Added refund error classification tests for definitive rejection versus unknown provider outcome.

## Commands and results

- `cd server && npm test -- --runInBand --cacheDirectory .codex-jest-cache-audit` — passed, 7 suites / 47 tests.
- `cd client && npm run build` — passed with Vite 6.4.5.
- JavaScript `node --check` over `server/src` and `server/tests` — passed.
- `git diff --check` — passed (Git reported its standard LF-to-CRLF working-copy notice for `.env.example`).
- `npm audit` on the original locks — found high advisories in Vite, `body-parser`, and Zod.
- `npm audit` after dependency updates — zero high advisories; two moderate in client React Router and six low in server test tooling.
- No lint script is configured.

No live deployment or financial transaction was performed.
