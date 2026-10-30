const pino = require('pino');
const requestLogSerializer = require('../src/config/requestLogSerializer');
const logRedactions = require('../src/config/logRedactions');
const serialize = require('../src/lib/serialize');
const fs = require('node:fs');
const path = require('node:path');

describe('checkout capability handling', () => {
  test('generated checkout links keep capability in the URL fragment', () => {
    const url = serialize.payment({ _id: 'pay_test', status: 'created', clientSecret: 'synthetic-checkout-token' }).checkout_url;
    expect(url).toContain('#secret=synthetic-checkout-token');
    expect(new URL(url).search).toBe('');
  });

  test('request logs omit query secrets and redact checkout authorization', () => {
    let output = '';
    const logger = pino({ redact: logRedactions }, { write: (line) => { output += line; } });
    const req = requestLogSerializer({
      id: 'req_test',
      method: 'GET',
      url: '/api/checkout/pay_test?secret=synthetic-checkout-token',
      headers: {
        authorization: 'Checkout synthetic-checkout-token',
        'x-api-key': 'synthetic-api-key',
        cookie: 'session=synthetic-cookie',
      },
    });
    logger.info({ req }, 'request');
    expect(output).not.toContain('synthetic-checkout-token');
    expect(output).not.toContain('synthetic-api-key');
    expect(output).not.toContain('synthetic-cookie');
    expect(output).toContain('/api/checkout/pay_test');
  });

  test('demo seed consumes fragment capabilities through Authorization without query fallback', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../scripts/seed.js'), 'utf8');
    expect(seed).toContain("new URLSearchParams(url.hash.slice(1)).get('secret')");
    expect(seed).toContain('authorization: `Checkout ${secret}`');
    expect(seed).not.toMatch(/url\.searchParams\.get\(['"]secret['"]\)/);
    expect(seed).not.toMatch(/confirm\?secret=/);
  });
});
