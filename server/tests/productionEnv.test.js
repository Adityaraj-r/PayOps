const { spawnSync } = require('node:child_process');
const path = require('node:path');

const sensitiveKeys = [
  'MONGO_URI', 'REDIS_URL', 'JWT_SECRET', 'WEBHOOK_SECRET_ENCRYPTION_KEY',
  'PLATFORM_ADMIN_EMAILS', 'CLIENT_URL', 'INTERNAL_API_URL', 'PAYMENT_PROVIDER',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
  'MOCKBANK_WEBHOOK_SECRET', 'ENABLE_DEV_ROUTES', 'PORT',
];

const validProductionEnv = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb+srv://payops:password@cluster.example.net/payops?retryWrites=true&w=majority',
  REDIS_URL: 'rediss://default:password@redis.example.net:6380',
  JWT_SECRET: 'mN3!vG8@xQ2#pL6$wR9%tY4^aB7&cD1*',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'QF83fM2JpPpQf9hwZxOa6gXhD3bK2rL6yR7nV1mA5cE',
  CLIENT_URL: 'https://payops.example.com',
  INTERNAL_API_URL: 'https://payops-api.example.com',
  PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'provider-secret-placeholder',
  RAZORPAY_WEBHOOK_SECRET: 'provider-webhook-secret-placeholder',
  ENABLE_DEV_ROUTES: 'false',
};

function loadProductionEnv(overrides = {}) {
  const childEnv = { ...process.env };
  for (const key of sensitiveKeys) delete childEnv[key];
  Object.assign(childEnv, validProductionEnv, overrides);
  return spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: path.resolve(__dirname, '..'),
    env: childEnv,
    encoding: 'utf8',
  });
}

describe('production environment validation', () => {
  test('accepts explicit remote production endpoints and strong secrets', () => {
    const result = loadProductionEnv();
    expect(result.status).toBe(0);
  });

  test('rejects production defaults that point to local services', () => {
    const result = loadProductionEnv({
      MONGO_URI: undefined,
      REDIS_URL: undefined,
      CLIENT_URL: undefined,
      INTERNAL_API_URL: undefined,
    });

    expect(result.status).toBe(1);
    for (const key of ['MONGO_URI', 'REDIS_URL', 'CLIENT_URL', 'INTERNAL_API_URL']) {
      expect(result.stderr).toContain(key);
    }
    expect(result.stderr).not.toContain('password');
    expect(result.stderr).not.toContain('provider-secret-placeholder');
  });

  test('rejects insecure or malformed production URLs', () => {
    const result = loadProductionEnv({
      MONGO_URI: 'mongodb://localhost:27017/payops',
      REDIS_URL: 'http://redis.example.com',
      CLIENT_URL: 'http://payops.example.com',
      INTERNAL_API_URL: 'http://localhost:4000',
    });

    expect(result.status).toBe(1);
    for (const key of ['MONGO_URI', 'REDIS_URL', 'CLIENT_URL', 'INTERNAL_API_URL']) {
      expect(result.stderr).toContain(key);
    }
  });
});
