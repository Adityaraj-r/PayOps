// PayOps | Validate deployment wiring against the repository layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '../..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
const render = yaml.load(fs.readFileSync(path.join(repoRoot, 'render.yaml'), 'utf8'));
assert.ok(Array.isArray(render.services), 'render.yaml must declare services');

const api = render.services.find((service) => service.name === 'onyx-api');
const redis = render.services.find((service) => service.name === 'onyx-redis');
assert.ok(api, 'Render Blueprint must retain the existing onyx-api service');
assert.ok(redis, 'Render Blueprint must retain the existing onyx-redis service');
assert.equal(api.type, 'web');
assert.equal(api.runtime, 'node');
assert.equal(api.rootDir, 'server');
assert.equal(api.buildCommand, 'npm ci --omit=dev');
assert.equal(api.startCommand, 'node src/server.js');
assert.equal(api.healthCheckPath, '/health');
assert.ok(fs.existsSync(path.join(repoRoot, 'server/src/server.js')), 'Render start command target must exist');
assert.ok(fs.existsSync(path.join(repoRoot, 'server/src/worker.js')), 'Configured in-process worker entry point must exist');

const envVars = new Map((api.envVars || []).map((entry) => [entry.key, entry]));
for (const name of ['MONGO_URI', 'WEBHOOK_SECRET_ENCRYPTION_KEY', 'CLIENT_URL', 'INTERNAL_API_URL']) {
  assert.equal(envVars.get(name)?.sync, false, `${name} must be manually supplied as a Render secret/environment value`);
}
assert.ok(envVars.get('JWT_SECRET')?.generateValue, 'Render must generate JWT_SECRET');
assert.ok(envVars.get('MOCKBANK_WEBHOOK_SECRET')?.generateValue, 'Render must generate MOCKBANK_WEBHOOK_SECRET');
assert.equal(envVars.get('RUN_WORKERS_IN_API')?.value, 'true', 'Current demo blueprint runs workers inside the API');
assert.equal(envVars.get('ENABLE_DEV_ROUTES')?.value, 'false', 'Development routes must be disabled on Render');
assert.deepEqual(envVars.get('REDIS_URL')?.fromService, {
  type: 'keyvalue', name: redis.name, property: 'connectionString',
});
assert.equal(redis.type, 'keyvalue');
assert.equal(redis.maxmemoryPolicy, 'noeviction');

const vercel = readJson('client/vercel.json');
assert.equal(vercel.installCommand, 'npm ci');
assert.equal(vercel.buildCommand, 'npm run build');
assert.equal(vercel.outputDirectory, 'dist');
const rewrites = vercel.rewrites || [];
const apiRewrite = rewrites.find((rule) => rule.source === '/api/(.*)');
const publicApiRewrite = rewrites.find((rule) => rule.source === '/v1/(.*)');
assert.ok(apiRewrite?.destination.endsWith('/api/$1'), 'Vercel must proxy dashboard API routes');
assert.ok(publicApiRewrite?.destination.endsWith('/v1/$1'), 'Vercel must proxy public API routes used by developer examples');
assert.equal(new URL(apiRewrite.destination.replace('$1', 'probe')).origin, new URL(publicApiRewrite.destination.replace('$1', 'probe')).origin,
  'Vercel dashboard and public API rewrites must target the same Render origin');
assert.deepEqual(rewrites.at(-1), { source: '/(.*)', destination: '/index.html' }, 'SPA fallback must be the final rewrite');

const clientPackage = readJson('client/package.json');
assert.ok(clientPackage.engines?.node?.startsWith('>=20'), 'Vercel frontend runtime must declare Node.js 20 or newer');
assert.ok(clientPackage.scripts?.build, 'Vercel frontend build script must exist');

process.stdout.write('Render Blueprint and Vercel configuration match the repository layout.\n');
