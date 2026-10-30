# Stage 3 Testing Results

**Date:** 2026-10-30
**Code base:** `a0a268426f5823696603e288bf4f290eedfb333b` plus uncommitted Stage 3 changes.

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

## Skipped, failed, and constrained checks

- The integration suite initially failed once due to a random mock-bank refund rejection. The test was made deterministic (mock refund failure rate disabled only inside the test process); the final full suite then passed.
- An earlier sandboxed full-suite attempt failed to bind the local HTTP test to `127.0.0.1` (`EACCES`). The full test suite was rerun with approved loopback access and passed.
- Npm audit requests initially could not reach the registry from the sandbox. With approved network access, the production server audit and full client audit both reported zero vulnerabilities. The full server dev-dependency audit was not run.
- No lint scripts are configured in either `client/package.json` or `server/package.json`; lint was not run.
- The smoke against the existing application stack could not return successful API responses because its API container could not resolve/connect to stopped Mongo. Its built-in Nginx error log can include original request targets on upstream failures; new supported checkout flows do not send capabilities in query strings, but legacy direct API query clients retain that risk. A successful path-preservation smoke was run separately against an isolated stub API. Disposable integration and smoke containers were removed; existing `onyx-*` resources were left unchanged.
- No deploy, live provider call, external service mutation, or real payment was performed.
