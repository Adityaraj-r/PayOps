const pino = require('pino');
const requestLogSerializer = require('../src/config/requestLogSerializer');
const logRedactions = require('../src/config/logRedactions');
const serialize = require('../src/lib/serialize');

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
});
