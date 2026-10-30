# PayOps final validation and release-readiness report

**Review date:** 2026-10-30

**Code baseline:** `002d351b36b0065658dcd610b4a63f5515c1fd8c` (`main`, synchronized with `origin/main`)

**Validation scope:** read-only application/configuration review plus disposable test infrastructure. No production credentials, data, deployments, or existing application containers were used.

## A. Executive summary

**Overall status: PARTIAL.** The backend suites, frontend production build, deployment validator, Compose validation, production dependency audits, Docker image builds, and isolated API workflows passed. The initial runtime proxy check found a defect: `GET /health/live` through dashboard Nginx returned **502** because its upstream resolved to port 80, while the API listens on port 4000. After the finding, `client/nginx.conf` was corrected to proxy to `api:4000`, and a follow-up using an isolated dashboard and API verified HTTP 200 for `/health/live`, HTTP 200 for `/api/` and `/v1/`, and a healthy dashboard container healthcheck when the API dependency was available. Nginx syntax and Compose configuration validation also passed after the correction. This verifies the targeted routing and healthcheck behavior; it is not a full production deployment validation.

The application is an educational simulation, not a real-money payment processor. Browser rendering and responsive viewport checks were unavailable. No complete browser UI or cross-browser end-to-end run is claimed.

## B. API validation matrix

The inventory below was derived from `server/src/app.js` and the mounted route files. There are **43 registered route handlers** (including conditional development routes and the generic provider webhook route). The table distinguishes live HTTP checks from static mapping and service-level tests. Global validation/auth/rate-limit errors use the API error envelope `{ "error": { "code", "message", "details?" } }`; observed statuses include 400, 401, 403, 404 and 422. 409, 429 and generic 500 paths were not comprehensively exercised by live HTTP requests.

### General and provider routes (5)

| Method and path | Authentication / inputs / response | Result |
|---|---|---|
| `GET /` | Public; no input; API name/version metadata JSON. | Not tested live. |
| `GET /health/live` | Public; no input; `{ok:true}`. | Direct API HTTP 200. Initial dashboard proxy returned 502; after the `api:4000` correction, isolated dashboard Nginx returned HTTP 200 and its healthcheck became healthy with the API available; see Section F. |
| `GET /health/ready` | Public; no input; Mongo/Redis readiness booleans. | HTTP 200 with both dependencies ready in the isolated stack. |
| `GET /health` | Public compatibility alias for readiness. | Not tested live. |
| `POST /webhooks/:provider` | Provider HMAC over raw body; provider-specific event payload; returns `{received, duplicate}`. | Exercised by mockbank workflow and signed-event integration tests; duplicate event handling also passed. |

### Merchant API routes (10)

All `/v1` routes require a merchant API key (`Authorization: Bearer …`) and rate limiting. POST requests accept `Idempotency-Key`; its use is optional at middleware level. Payment amount is integer paise; `customer.email` is required. Public API POST validation and idempotency use the common error envelope.

| Method and path | Inputs / response | Result |
|---|---|---|
| `POST /v1/payments` | Payment body (`amount`, optional INR `currency`, customer, optional description/metadata); payment object and checkout URL. | HTTP create, replay, and different-payload conflict checked through Nginx; 201, replay header, and 422 observed. Invalid body returned 400. |
| `GET /v1/payments` | Optional `status`, `limit`, `cursor`, `q`; paginated payment list. | HTTP 401 without API key and HTTP 200 with key checked through Nginx. |
| `GET /v1/payments/:id` | Payment ID; payment object. | HTTP 200 and matching persisted ID checked through Nginx. |
| `POST /v1/payments/:id/refunds` | Optional amount/reason; refund object. | Not directly exercised over this route. Same refund service passed via dashboard route and integration tests. |
| `GET /v1/payments/:id/refunds` | Payment ID; refund list. | Not tested live. |
| `GET /v1/refunds/:id` | Refund ID; refund object. | Missing valid-format ID returned 404; existing-refund read not tested live. |
| `GET /v1/balance` | No body; ledger-derived balance response. | Not tested live. |
| `POST /v1/webhook_endpoints` | URL, events, optional description; endpoint response reveals new secret once. | Not tested live. Dashboard endpoint creation was tested. |
| `GET /v1/webhook_endpoints` | No body; endpoint list. | Not tested live. |
| `DELETE /v1/webhook_endpoints/:id` | Endpoint ID; deleted confirmation. | Not tested live. |

### Dashboard routes (24)

Except registration/login, dashboard routes require a merchant JWT. Platform operations also require the configured platform-admin allowlist. Request bodies are schema-validated where a schema is attached; response shapes are listed by route behavior.

| Method and path | Inputs / response | Result |
|---|---|---|
| `POST /api/dashboard/auth/register` | Name, email, password; JWT, merchant, one-time API key. | HTTP 201; synthetic account only. |
| `POST /api/dashboard/auth/login` | Email/password; JWT and merchant. | HTTP 200; synthetic account only. |
| `GET /api/dashboard/me` | JWT; current merchant. | HTTP 200 through Nginx; identity matched. |
| `GET /api/dashboard/overview` | JWT; 14-day summary, balances, volume series, recent payments. | HTTP 200; verified new payment appears in recent records and `created` status count. Other aggregation totals were not independently recomputed. |
| `GET /api/dashboard/payments` | JWT; optional list query filters/cursor/limit; paginated payments. | HTTP 200. |
| `POST /api/dashboard/payments` | JWT; payment body; payment object. | Not tested live. The UI mapping was statically reviewed. |
| `GET /api/dashboard/payments/:id` | JWT; payment ID; payment, attempts, refunds, journal, provider events and deliveries. | HTTP 200 for success and failure workflows; missing valid-format ID returned 404. |
| `POST /api/dashboard/payments/:id/refunds` | JWT; optional amount/reason; refund object. | HTTP 201; refund completed in isolated worker. |
| `GET /api/dashboard/ledger` | JWT; accounts, latest journal records and integrity result. | HTTP 200; `integrity.balanced` true after capture/refund. |
| `GET /api/dashboard/webhooks` | JWT; optional `status=failing`; endpoints and up to 100 latest deliveries. | HTTP 200; success and retryable delivery records observed. |
| `POST /api/dashboard/webhooks/endpoints` | JWT; URL/events/description; endpoint and one-time secret. | HTTP 201 for local success and failure sinks. |
| `POST /api/dashboard/webhooks/endpoints/:id/reveal` | JWT; endpoint ID; returns not-revealable conflict after existence check. | Not tested live. |
| `POST /api/dashboard/webhooks/endpoints/:id/rotate` | JWT; endpoint ID; rotated endpoint and one-time secret. | Not tested live. |
| `DELETE /api/dashboard/webhooks/endpoints/:id` | JWT; endpoint ID; deleted confirmation. | Not tested live. |
| `POST /api/dashboard/webhooks/deliveries/:id/replay` | JWT; delivery ID; replayed delivery. | Not tested live; replay eligibility is covered by service-level review/tests only. |
| `GET /api/dashboard/settlements` | JWT; latest settlement list (bounded). | HTTP 200; newly created isolated settlement appeared in history. |
| `POST /api/dashboard/settlements/run` | JWT; no required body; settlement or `null`. | HTTP 200; isolated matured fixture produced a persisted simulated settlement. |
| `GET /api/dashboard/refunds/attention` | JWT + platform-admin allowlist; operator refund list. | Not tested live. |
| `POST /api/dashboard/refunds/:id/check` | JWT + platform-admin; refund ID and required reason; provider status check. | Not tested live. |
| `POST /api/dashboard/refunds/:id/resolve` | JWT + platform-admin; action and reason; resolution result. | Not tested live. |
| `GET /api/dashboard/reconciliation` | JWT; latest provider reconciliation reports. | HTTP 200. |
| `POST /api/dashboard/reconciliation/run` | JWT + platform-admin; no required body; latest report. | Ordinary merchant denial returned 403 in `reconciliationIsolation.test.js`; successful admin run not tested live. |
| `GET /api/dashboard/keys` | JWT; API-key metadata list. | HTTP 200. |
| `POST /api/dashboard/keys/roll` | JWT; rotate merchant API key; new key response. | Not tested live. |

### Checkout and conditional development routes (4)

| Method and path | Authentication / inputs / response | Result |
|---|---|---|
| `GET /api/checkout/:id` | Checkout capability in `Authorization: Checkout …`; legacy `?secret=` fallback remains; checkout view. | HTTP 200 through Nginx with header for a valid checkout. Expiry-on-read passed in integration tests. |
| `POST /api/checkout/:id/confirm` | Same capability; optional method/simulation outcome/provider fields; updated checkout view. | HTTP 200 for simulated success and failure through Nginx. |
| `POST /dev/webhook-sink` (only when enabled) | No auth in development; optional `fail_rate`; records event and returns 200 or simulated 503. | Reached by isolated workers for successful and failing delivery scenarios. |
| `GET /dev/webhook-sink` (only when enabled) | No auth in development; returns recent sink events. | Not directly queried. |

### API error and persistence observations

Live HTTP checks exercised 22 distinct backend route templates through direct API or dashboard Nginx, with **33 passing assertions** across registration/login, auth, invalid payloads, idempotency replay/conflict, checkout, payment success/failure, refunds, ledger integrity, webhook states, settlement/history, reconciliation read, key listing, missing records, and public payment reads. The initial dashboard-origin health proxy check returned 502; the isolated post-fix check returned 200. An initial probe to `/api/dashboard/webhooks/endpoints` returned 404 because that is not a registered GET path; the actual combined list route is `/api/dashboard/webhooks` and passed. The 404 on a nonexistent checkout ID is a not-found outcome; missing capability on an existing payment was not separately exercised over HTTP.

The integration suite additionally verifies persisted counts/state through Mongo models, unique idempotency records, payment and refund transitions, duplicate/out-of-order provider events, recovery after job removal, duplicate delivery claims, stale delivery lease recovery, and posted-journal update/delete rejection. Most routes in the 43-handler inventory were not individually exercised over HTTP; see each row above.

## C. Frontend route and integration validation

`client/src/App.jsx` registers **11 page routes** plus a wildcard redirect. Their components and API mappings were statically reviewed against backend route mounts. Browser rendering count is **0**: no browser E2E harness or usable browser automation was available. The dashboard root was served as built HTML through Nginx, which does not prove React route rendering or interaction.

| UI route | Component / API mapping | Rendering / integration result |
|---|---|---|
| `/` (protected overview) | `Overview`; `/overview`, `/webhooks`, `/ledger`, `/settlements` | API mappings statically matched; overview values partially compared by HTTP smoke. Browser render not tested. |
| `/payments` | `Payments`; `/payments` | Mapping reviewed; page render not tested. |
| `/payments/:id` | `PaymentDetail`; `/payments/:id`, `/payments/:id/refunds` | Mapping reviewed; backend detail/refund workflow passed; browser render not tested. |
| `/ledger` | `Ledger`; `/ledger` | Mapping reviewed; backend integrity response passed; browser render not tested. |
| `/webhooks` | `Webhooks`; `/webhooks`, endpoint create/rotate/delete, delivery replay | Mapping reviewed; endpoint create and delivery status passed; rotation/replay UI not tested. |
| `/settlements` | `Settlements`; `/settlements`, `/settlements/run` | Mapping reviewed; API simulation/history passed; browser render not tested. |
| `/reconciliation` | `Reconciliation`; `/reconciliation`, `/reconciliation/run` | Mapping reviewed; read route passed; authorized admin run not tested. |
| `/developers` | `Developers`; `/keys`, `/keys/roll`, public `/v1` examples | Mapping reviewed; key list passed; key rotation UI not tested. |
| `/checkout/:id` | `Checkout`; `/checkout/:id`, `/checkout/:id/confirm` | Backend capability/success/failure passed through proxy; browser interaction not tested. |
| `/login` | `Auth`; `/dashboard/auth/login` | API login passed; browser form/render not tested. |
| `/register` | `Auth`; `/dashboard/auth/register` | API registration passed; browser form/render not tested. |

Static component review found loading, error, empty states, bounded lists, ID overflow styling, and modal keyboard handling. These states, responsive breakpoints, focus behavior, browser console errors, and desktop/tablet/mobile layouts were not visually or interactively exercised. No React component test script is configured.

### Dashboard data comparison

- The live overview response reported a 14-day window; the newly created payment appeared in `recent_payments` and its `created` count. Captured volume, fee totals, and every status aggregation were not independently recomputed against a full ledger dataset.
- Webhook dashboard summary uses the latest 100 delivery records; the runtime workflow observed both successful and retryable/failed delivery state.
- Ledger display uses up to 50 journal entries; the API integrity result was balanced after capture/refund.
- Settlement list is bounded to 50. The isolated settlement was persisted and appeared in history; this does not establish correct per-payment attribution.
- Refund history is available within payment detail, not a global refund history route. The journal API does not expose entry status.

## D. End-to-end workflow results

All flows used a newly created synthetic merchant in the disposable validation database. The API and in-process worker were exercised through the actual HTTP server; requests were routed through the dashboard Nginx where applicable.

| Workflow | Result | Evidence and boundary |
|---|---|---|
| Successful payment | **PASS** | Created payment over `/v1`, loaded checkout with Authorization capability, confirmed `success`, observed `captured` through detail endpoint, verified balanced ledger and webhook delivery. |
| Failed payment | **PASS** | Confirmed `failure`; persisted state became `failed` and had no capture journal entry. |
| Idempotency | **PASS** | Same key/body returned same payment ID and replay header; changed body returned 422 `idempotency_key_reused`. Integration tests also assert one persisted payment for concurrent duplicate keys. |
| Refund | **PASS** | Partial refund accepted and reached `succeeded`; payment detail and balanced ledger verified. Concurrent reservation cap and idempotent refund creation passed integration tests. |
| Webhook failure and recovery | **PASS with scope limits** | Live local success sink and 503 failure sink produced delivery statuses; automated integration tests removed queued jobs, verified recovery without duplicate active work, tested stale/missing lease recovery and concurrent claims. A separate production worker process restart was not performed; recovery was exercised by the service against isolated Redis/Mongo state. |
| Settlement simulation | **PASS for simulation path; allocation remains limited** | With test-only maturity override, run endpoint persisted a settlement and history returned it. The simulator sweeps balances and links only qualifying mature payments; complete allocation/reconciliation is not established. |

These checks do not establish real-money transfer, bank settlement, or production payment behavior.

## E. Database and background-worker results

- MongoDB 7 connected to a disposable single-node replica set; the lifecycle test initializes models/indexes before asserting uniqueness and transactions.
- Redis 7 connected in isolation; BullMQ jobs were observed and recovery after explicit queue-job removal was tested. Existing project Redis/data were not used.
- Payment creation/capture/refund and ledger writes completed; ledger integrity reported balanced. Duplicate event and duplicate posting protections were exercised by integration/domain tests.
- Mongoose journal mutation/deletion safeguards passed attempted update/delete/bulk-write tests. Native MongoDB collection/admin access can bypass Mongoose middleware; database-role append-only protection is not configured.
- The API and in-process worker ran together for HTTP smoke workflows. The separate Compose worker container was image-built but not started. Shutdown behavior under dependency loss was not tested end to end; mocked idempotency persistence and production rate-limit failure paths are covered by unit tests.
- No historical or production records were altered. The only deliberate database mutations were synthetic records in the disposable database.

## F. Security audit

**Observed protections:** checkout uses URL fragments and Authorization headers for new browser flows; request serializers redact credentials and application logs omit query strings; provider callbacks verify raw-body signatures and deduplicate event IDs; public mutations support idempotency; merchant scoping/JWT/API-key authentication and production rate limiting are present; production seeding is blocked; Render disables development routes; journal Mongoose update/delete paths are blocked; Nginx API locations precede SPA fallback and access logs use `$uri`.

**Finding and resolution — Nginx health proxy:** The initial `client/nginx.conf` setting, `proxy_pass http://api/health/live`, omitted a port and therefore used Nginx's default port 80. The isolated runtime check returned HTTP 502, with connection refusal to `api:80`; the backend listens on port 4000. The correction now uses `proxy_pass http://api:4000/health/live`. A post-fix isolated dashboard runtime check returned HTTP 200 through Nginx for `/health/live`; the equivalent dashboard healthcheck reported healthy with the API dependency available. `/api/` and `/v1/` continued returning HTTP 200 through dashboard Nginx, with the tested paths and query strings preserved. Nginx syntax and Compose configuration validation passed after the correction. The original 502 is retained here as the pre-fix finding, not the current result.

**Warnings and unverified areas:**

- Backend query-token fallback remains for legacy checkout clients. Legacy query links and infrastructure logs remain a residual exposure risk; an Nginx upstream error log can include the original request target.
- Journal immutability is application/Mongoose-level, not database-admin proof.
- Dashboard bearer tokens use localStorage, which has the usual XSS exposure boundary; no XSS was demonstrated.
- Docker Compose has a fixed development-only JWT fallback while `NODE_ENV=development`; do not use it in production. Render generates its production JWT secret.
- No dedicated `gitleaks`, `trufflehog`, or `detect-secrets` executable was available. A limited pattern scan found only placeholder/example MongoDB URI shapes in `server/.env.example` and `server/tests/productionEnv.test.js`; the test URI uses an example host. No actual credentials were found in the scanned tracked files. The pre-existing untracked root lockfile was intentionally left unread and excluded from that scan.
- No private `.env`/`.env.local` files were present at the checked root/server/client locations. `.env.example` contains placeholders, not credentials.
- This was a repository/configuration review, not a penetration test. Hosted accounts and production secrets were not inspected.

## G. Dependency, build, and configuration results

| Check | Result |
|---|---|
| Backend default suite: `npm test -- --runInBand --no-cache --forceExit --cacheDirectory .jest-cache-healthfix` | **PASS:** 18 suites passed, 1 skipped; 73 tests passed, 5 skipped. |
| Backend integration-enabled suite: `PAYOPS_INTEGRATION=1 npm test -- --runInBand --no-cache --forceExit --cacheDirectory .jest-cache-healthfix-integration` with disposable MongoDB 7 replica set and Redis 7 | **PASS:** 19 suites, 78 tests. Includes lifecycle, idempotency, refund concurrency, ledger immutability, webhook job/lease recovery. |
| `client`: `npm run build` | **PASS:** Vite 6.4.5, 59 modules. |
| `server`: `npm run check:deploy-config` | **PASS:** Render/Vercel configuration matches repository layout. Does not verify live hosted services. |
| `docker compose config --quiet` | **PASS** for Compose syntax/config resolution. |
| API and dashboard Docker builds under unique `payops-final-validation-*` tags | **PASS.** Existing `payops-api:local` tag was not replaced. |
| Nginx `nginx -t` in uniquely tagged dashboard image | **PASS** syntax validation. Post-fix isolated runtime `/health/live`, `/api/`, and `/v1/` routing also **PASS** with HTTP 200; the dashboard healthcheck became healthy with the API available. |
| Server `npm audit --omit=dev --audit-level=moderate` | **PASS:** zero production dependency vulnerabilities. |
| Client `npm audit --audit-level=moderate` | **PASS:** zero vulnerabilities. |
| Full server `npm audit --audit-level=moderate` | **WARNING:** six low severity advisories in the Jest/deepmerge development dependency chain; no moderate/high findings. `npm audit fix --force` proposes a breaking downgrade to Jest 25.1.0; no dependency changes were made. |
| Lint | **NOT TESTED:** neither package defines a lint script. |
| Browser E2E / viewport review | **NOT TESTED:** browser automation unavailable and no frontend test harness configured. |
| `git diff --check` | **PASS:** run after this report was created; untracked report whitespace was separately inspected. |

Disposable validation containers, network, uniquely tagged dashboard image, and generated Jest caches were removed. Existing `onyx-api-1` and `onyx-worker-1` were observed running at the final check and were not intentionally stopped or restarted during validation. The app stack uses `payops-api:local`; validation images used separate tags.

## H. Known limitations

- Settlement is a balance-sweep simulation with an unresolved allocation/traceability mismatch.
- Reconciliation is a provider-record comparison, not bank statement or complete settlement reconciliation.
- Webhook delivery is at least once; receivers must deduplicate. Queue durability depends on Redis persistence/tier.
- Checkout query compatibility remains during migration; token storage and upstream error-log limits remain.
- Ledger immutability does not protect against direct MongoDB/native-driver/admin writes.
- No approved retention periods or automatic archival/deletion are implemented.
- Dashboard summaries are bounded and do not constitute complete historical totals.
- No browser rendering, browser console, keyboard, or viewport checks were run.
- The Nginx liveness upstream port defect was corrected from the implicit port 80 to `api:4000`; isolated post-fix routing and the dashboard healthcheck passed. This targeted isolated check does not establish the health of a deployed stack.
- Optional Razorpay code is not evidence of live payment processing and was not connected to a live account.

## I. Final status by acceptance criterion

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Backend default suite | **PASS** | 18 suites passed, 1 skipped; 73 tests passed, 5 skipped. |
| Backend integration-enabled suite | **PASS** | 19 suites, 78 tests including disposable MongoDB/Redis integration. |
| Important API endpoints exercised | **PARTIAL** | 22 of 43 route templates received live HTTP checks; full route inventory included above. |
| Frontend/backend API mappings reviewed | **PASS** | Static path/method/auth mapping checked; selected `/api` and `/v1` paths passed through Nginx. |
| Main UI routes rendered | **NOT TESTED** | 11 routes reviewed in source, 0 React routes rendered in a browser. |
| Dashboard values compared with API | **PARTIAL** | New payment/status and bounded lists verified; full aggregate recomputation not done. |
| Core business workflows | **PASS with limits** | Success, failure, idempotency, refund, webhook, ledger, and settlement simulation exercised with disposable data; no real-money behavior. |
| Ledger consistency and application immutability | **PASS** | Balance assertions and Mongoose mutation rejection tests passed; native database bypass remains. |
| Webhook recovery | **PASS with limits** | Lost-job, stale lease and duplicate claim tests passed; no separate worker-process restart test. |
| Docker configuration/build and targeted routing | **PASS with scope limits** | Compose config, uniquely tagged image builds, Nginx syntax, and isolated post-fix `/health/live`, `/api/`, `/v1/` requests passed; the dashboard healthcheck became healthy with its API dependency available. This was not a deployed-stack validation. |
| Security/dependency findings documented | **PARTIAL** | Audits ran; no dedicated secret scanner or browser/penetration test. Six low dev advisories remain. |
| Existing user data/services preserved | **PASS** | Only isolated synthetic data used; existing app containers were observed running at the final check and were not intentionally stopped or restarted during validation. |
| Application logic and unrelated configuration preserved | **PASS** | The only application configuration correction was the targeted `client/nginx.conf` health upstream port. No business logic, tests, dependencies, or deployment resources were changed. |

## J. Interview readiness

The strongest evidence-backed explanations are idempotency replay/conflict handling, simulated payment success/failure transitions, balanced capture/refund ledger postings, concurrent refund reservation, signed provider-event deduplication, MongoDB-backed missing-job recovery, Mongoose-level journal immutability, and the bounded dashboard metrics. These are supported by automated tests and/or isolated API checks.

Qualify the work as a simulation. Do not claim real-money processing, actual payout, full settlement reconciliation, exactly-once webhook delivery, database-admin-proof immutability, or completed browser visual testing. The targeted dashboard liveness proxy correction was verified through isolated Nginx/API containers; this does not replace validation of a deployed stack. Browser rendering remains unverified.

## Files and repository integrity

This report records the original validation and the subsequent targeted healthcheck correction and post-fix verification. `client/nginx.conf` contains the one-line upstream port correction; this documentation update changes only `docs/FINAL_VALIDATION_REPORT.md`. No application business logic, tests, dependencies, or deployment resources were changed. The pre-existing root `package-lock.json` remains untracked and untouched. No files were staged, committed, pushed, or deployed. Existing application containers were not intentionally stopped or restarted; they were observed running at the final check.
