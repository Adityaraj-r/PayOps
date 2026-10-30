# Stage 3 and Stage 4 Testing Results

**Date:** 2026-10-30
**Stage 3 code base:** commit `d79fd1762830686b3e62518e8662c031784726bd` (current `main` and `origin/main` at Stage 4 start). The audited Stage 1 hash `a0a268426f5823696603e288bf4f290eedfb333b` is an ancestor. **Stage 4:** local uncommitted changes in this worktree; the pre-existing untracked root `package-lock.json` was preserved and not used/modified.

## Executed checks

| Check | Result |
|---|---|
| Focused backend regressions: `npm test -- --runInBand --cacheDirectory .jest-cache --runTestsByPath tests/checkoutSecurity.test.js tests/dockerRouting.test.js tests/seedSafety.test.js` (`server`) | **Passed:** 3 suites, 4 tests. |
| Final full backend suite with integration enabled: `PAYOPS_INTEGRATION=1`, temporary Mongo replica set + Redis, `npm test -- --no-cache --runInBand --forceExit` (`server`) | **Passed on final code:** 19 suites, 75 tests. Includes checkout expiry, lost queue job recovery, repeated recovery, duplicate handler claims, concurrent refund reservation cap, ledger/refund/lifecycle checks. |
| Frontend production build: `npm run build` (`client`) | **Passed:** Vite production build completed. |
| Compose syntax: `docker compose config --quiet` | **Passed.** |
| Docker build: `docker compose build` | **Passed:** API/worker and dashboard images built. |
| Nginx validation: `nginx -t` inside temporary dashboard image | **Passed.** |
| Production dependency audit: `npm audit --omit=dev` (`server`) | **Passed:** 0 vulnerabilities. |
| Frontend dependency audit: `npm audit` (`client`) | **Passed:** 0 vulnerabilities. |
| Docker route/proxy unit assertions | **Passed:** `/api/` and `/v1/` target the API with headers, precede SPA fallback, and configure query-safe access logging. |
| Docker routing runtime smoke | **Passed with isolated stub API:** `/api/dashboard/ping` reached the stub with its path and forwarded headers; `/v1/payments` reached it with its path and forwarded headers; `/` served the SPA. Nginx syntax passed. A separate probe of the pre-existing API container returned 502 because its Mongo dependency was stopped; its Nginx error log included the original request target, while access logs remained query-free. This was a synthetic marker, not a credential. No existing project containers were restarted or changed. |
| `git diff --check` | **Passed.** Git printed only a line-ending normalization warning for the new integration-test lines; no whitespace errors were reported. |

## Stage 4 verification

| Check | Result |
|---|---|
| Focused backend tests: `npm test -- --runInBand --cacheDirectory .jest-cache-stage4 --runTestsByPath tests/checkoutSecurity.test.js tests/ledger.test.js` (`server`) | **Passed:** 2 suites, 12 tests. Covers seed fragment/header regression, checkout log redaction/link shape, and ledger-domain invariants. |
| Full backend suite: `PAYOPS_INTEGRATION=1`, isolated MongoDB 7 single-node replica set on localhost port 27117 and Redis 7 on port 16380; `npm test -- --no-cache --runInBand --forceExit --cacheDirectory .jest-cache-stage4` (`server`) | **Passed on clean isolated DB/Redis:** 19 suites, 77 tests. Includes 4 lifecycle integration tests, webhook loss/recovery/duplicate claim, checkout expiry, refund concurrency, and new JournalEntry save/update/delete/bulk-write mutation attempts. |
| Frontend production build: `npm run build` (`client`) | **Passed:** Vite 6.4.5 built 59 modules. |
| Docker Compose validation and image build: `docker compose config --quiet`, `docker compose build` | **Passed:** API/worker and dashboard images built. No project service was started or deployed. |
| Nginx syntax: `docker run --rm --add-host api:127.0.0.1 payops-dashboard:local nginx -t` | **Passed:** syntax and config validation successful. A first standalone check without the Compose `api` hostname failed during DNS resolution; adding a temporary hostname mapping allowed syntax validation. |
| Deployment config: `npm run check:deploy-config` (`server`) | **Passed:** Render Blueprint and Vercel configuration match repository layout. |
| Server production dependency audit: `npm audit --omit=dev` | **Passed:** 0 vulnerabilities in production dependencies. |
| Full server dependency audit: `npm audit` | **Finding:** 6 low-severity advisories in Jest's transitive development dependency chain (`deepmerge` via `jest-config`). `npm audit fix --force` proposes downgrading Jest to 25.1.0 (breaking); no dependency changes were made. |
| Client dependency audit: `npm audit` | **Passed:** 0 vulnerabilities. |
| Lint | **Not run:** neither package manifest defines a lint script. |
| Checkout browser E2E | **Not run:** no frontend browser test harness is configured. Code build and backend regression tests passed. |
| Database-native ledger immutability | **Not verified/enforced:** Mongoose pathways are blocked and tested. MongoDB native collection/admin credentials bypass middleware. No production or deployed DB role was changed. See `LEDGER_IMMUTABILITY.md`. |
| Settlement allocation tests | **Not run:** implementation is intentionally paused for policy approval; design and cases are in `SETTLEMENT_ALLOCATION_DESIGN.md`. |
| Retention/archival tests | **Not run:** no cleanup was implemented pending approved periods and jurisdiction. |
| `git diff --check` | **Passed:** no whitespace errors. Git emitted line-ending normalization warnings for edited text files. |

### Stage 4 test attempts and constraints

- One focused Jest invocation failed before assertions because the sandbox blocked cache writes to the Windows temp directory. Re-running with `--cacheDirectory .jest-cache-stage4` passed.
- The first integration attempt exposed an invalid synthetic ledger account fixture; it was corrected to real chart-of-account names, and the lifecycle suite passed 4/4 tests.
- A subsequent full-suite attempt reused Redis test-queue state left by that failed run and returned `queued: 3` where the test expected `queued: 1`. The isolated Redis test DB was flushed and a fresh Mongo database used; the final full run passed 19/77. This was test-environment residue, not a product regression.
- Disposable containers `payops-stage4-mongo` and `payops-stage4-redis` were used without project volumes or production data, then removed. Existing `onyx-*` containers were not restarted or changed.
- No deployment, provider call, external resource mutation, commit, push, or production database role change was performed. Temporary test containers and the temporary Jest cache were removed after verification.

## Skipped, failed, and constrained checks

- The integration suite initially failed once due to a random mock-bank refund rejection. The test was made deterministic (mock refund failure rate disabled only inside the test process); the final full suite then passed.
- An earlier sandboxed full-suite attempt failed to bind the local HTTP test to `127.0.0.1` (`EACCES`). The full test suite was rerun with approved loopback access and passed.
- Npm audit requests initially could not reach the registry from the sandbox. With approved network access, the production server audit and full client audit both reported zero vulnerabilities. The full server dev-dependency audit was not run.
- No lint scripts are configured in either `client/package.json` or `server/package.json`; lint was not run.
- The smoke against the existing application stack could not return successful API responses because its API container could not resolve/connect to stopped Mongo. Its built-in Nginx error log can include original request targets on upstream failures; new supported checkout flows do not send capabilities in query strings, but legacy direct API query clients retain that risk. A successful path-preservation smoke was run separately against an isolated stub API. Disposable integration and smoke containers were removed; existing `onyx-*` resources were left unchanged.
- No deploy, live provider call, external service mutation, or real payment was performed.
