# PayOps deployment checklist

## Before deploying

- [ ] Keep all real credentials in Render's secret environment settings. Do not put them in `.env.example`, source files, or Vercel variables.
- [ ] If values previously placed in `server/.env.example` were real or were pushed to Git, rotate them before deployment.
- [ ] Create a MongoDB Atlas database user with a unique strong password. Set `MONGO_URI` in Render and include the existing `onyx` database name. Confirm the cluster supports replica-set transactions and allowlist the Render service's outbound IP ranges rather than opening Atlas to all IPs where possible.
- [ ] In Render, deploy the Blueprint. It generates `JWT_SECRET`, `MOCKBANK_WEBHOOK_SECRET`, and `REDIS_URL`. Keep `ENABLE_DEV_ROUTES=false` and `RUN_WORKERS_IN_API=true` for the included free-tier topology.
- [ ] Set and back up `WEBHOOK_SECRET_ENCRYPTION_KEY` before rollout. After deploying compatible code, preview and apply the webhook-secret encryption migration from a trusted environment with production database access.
- [ ] Set Render `CLIENT_URL` to the deployed Vercel origin and `INTERNAL_API_URL` to the Render API origin.
- [ ] Verify both API hostnames in `client/vercel.json` (`/api/*` and `/v1/*`) match the deployed Render API. The Vercel rewrites are configured in that file, not through a Vite environment variable.
- [ ] Choose a provider. `mockbank` is a simulator, not a real payment processor. For Razorpay, set `PAYMENT_PROVIDER=razorpay` and provide `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in Render. Start with Razorpay test credentials.
- [ ] If using Razorpay, configure its webhook URL as `https://<api-host>/webhooks/razorpay`, select the payment events the app handles, and use the same webhook secret in Render.
- [ ] Do not use the documented seed demo credentials for real data. If you seed a public demo, set custom seed email/password values and use non-sensitive test records.

## Verify after deploying

- [ ] Confirm `https://<api-host>/health` returns HTTP 200 with MongoDB and Redis healthy.
- [ ] Confirm `/health/live` and `/health/ready` behave as expected. `/health` remains a readiness alias.
- [ ] Open the Vercel site and check registration/login, dashboard API requests, and checkout navigation.
- [ ] Create a test payment with mockbank or Razorpay test mode; verify provider event handling, ledger balance, refund path, and webhook delivery.
- [ ] In production, confirm `/dev/webhook-sink` is unavailable and webhook endpoint registration rejects HTTP and private/reserved destinations.
- [ ] Confirm Render logs contain no credentials or authorization headers.
- [ ] Configure monitoring for service health, dead-letter jobs, refunds marked `needs_attention`, and reconciliation mismatches.
- [ ] Confirm database backups and perform a restore drill before storing real financial or customer data.
- [ ] Re-run `npm ci`, `npm test` in `server`, `npm run build` in `client`, and `npm audit` after future dependency changes.

## Operational limits

- Render free services may sleep and free Key Value loses BullMQ queue state on restart. The included free-tier setup is for demos, not real payment traffic.
- Refunds with unknown provider outcomes intentionally hold the reserved amount for manual reconciliation.
- This checklist does not establish PCI DSS compliance or replace a production security review.
