# PayOps rebrand: deployment follow-up

The code now presents as PayOps. These account and hosted-resource changes require access to the corresponding dashboards:

- **GitHub:** confirm `Adityaraj-r/PayOps` is the canonical repository, update its description/topics, enable Actions and Pages as needed, and replace the old `differentiatorX/onyx` Pages URL after the new Pages site is live. The local Git remote may still point to the old repository; verify it with `git remote -v` and set it to `https://github.com/Adityaraj-r/PayOps.git` if appropriate.
- **Render:** the blueprint intentionally retains resource names `onyx-api` and `onyx-redis` to avoid recreating deployed services. Keep their existing environment values. If you rename either resource in Render, update `REDIS_URL` references as needed, `INTERNAL_API_URL`, and the API destination in `client/vercel.json`.
- **Vercel:** rename the project and assign the desired PayOps domain. Update server `CLIENT_URL` in Render and replace the old live-demo URLs in README and `docs/index.html` once the new deployment is available. `client/vercel.json` currently proxies to the existing Render API hostname.
- **MongoDB:** the database remains `onyx` so existing data is preserved. Keep the database path in `MONGO_URI`; changing it needs a planned data migration.
- **SDK publishing:** `@payops/node` is the new package name. Check that the npm scope/name is available and owned by the publishing account before publishing; existing users of `@onyx/node` need a migration note.
- **Screenshots:** replace the README screenshots after capturing the rebranded UI; the current raster images still show the old branding and seeded demo address.

The demo seed account, legacy webhook headers, and `onyx.token` browser token key remain supported for existing installations. `ONYX_*` environment names are accepted where documented as compatibility fallbacks.
