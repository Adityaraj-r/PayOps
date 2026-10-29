# Deploying a live PayOps demo for free

*PayOps by [differentiatorX](https://github.com/differentiatorX)*

| Piece | Host | Plan |
|:--|:--|:--|
| Database | MongoDB Atlas | M0 free (supports transactions) |
| API and workers | Render web service | Free |
| Redis | Render Key Value | Free |
| Dashboard and checkout | Vercel | Hobby |
| Landing page | GitHub Pages | Free |

## 1. MongoDB Atlas
1. Create a free M0 cluster.
2. Database Access: add a user with a strong password.
3. Network Access: allow `0.0.0.0/0` (Render's free IPs change).
4. Connect, Drivers: copy the URI and put `/onyx` before the `?`. The database keeps this legacy name to preserve existing data, for example
   `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/onyx?retryWrites=true&w=majority`

## 2. Render (API, workers, Redis)
1. Render dashboard: New, Blueprint, select the PayOps repository. It reads `render.yaml`.
2. Fill the required blank values:
   - `MONGO_URI`: the Atlas URI from step 1
   - `INTERNAL_API_URL`: the current Render service URL, e.g. `https://onyx-api.onrender.com` (the deployed service still uses its legacy resource name)
   - `CLIENT_URL`: your Vercel URL from step 3 (come back and set it after Vercel deploys)
   - `WEBHOOK_SECRET_ENCRYPTION_KEY`: generate at least 32 random bytes and store the base64url value in Render. Do not reuse it across environments.
   - Optionally set `PLATFORM_ADMIN_EMAILS` to the comma-separated emails of registered operator accounts.
   - `PLATFORM_ADMIN_EMAILS`: optional comma-separated allowlist of registered account emails permitted to trigger a platform-wide reconciliation run. Ordinary merchants can view only their own report data.
3. Deploy. Check `https://<your-api>.onrender.com/health` returns `"ok": true`.

Workers run inside the API process (`RUN_WORKERS_IN_API=true`) because separate background workers are not free on Render.

## 3. Vercel (dashboard)
1. Import the repo. Set **Root Directory** to `client`. Framework preset: Vite.
2. `client/vercel.json` currently points to the existing `onyx-api` Render service. Update it if you rename that external Render service.
3. Deploy, then copy the Vercel URL into Render's `CLIENT_URL` and redeploy the API.

## 4. Seed demo data
From your machine:
```bash
cd server && npm install
API_URL=https://onyx-api.onrender.com npm run seed
```
Recruiters can now sign in with `demo@onyx.dev` / `onyx-demo-123`, or create their own test account.

## 5. Link it
Add the Vercel URL to the README header and to the landing page buttons in `docs/index.html`.

## Free-tier behaviour to know
- Render free services sleep after 15 idle minutes. The first request takes about a minute to wake it; scheduled jobs pause while it sleeps. Open the API once before an interview.
- Webhooks to the built-in test receiver fail 30% of the time on purpose, so the retries show up in the dashboard.
