const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('demo seed refuses to run in production before making requests', () => {
  const result = spawnSync(process.execPath, ['scripts/seed.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', API_URL: 'http://127.0.0.1:1' },
    encoding: 'utf8',
    timeout: 5000,
  });
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain('demo seed script is disabled in production');
});
