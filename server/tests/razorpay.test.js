const razorpay = require('../src/providers/razorpay');

describe('Razorpay refund retries', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('sends the stable PayOps refund ID as the provider idempotency key', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rfnd_provider_1' }),
    });

    const request = { providerPaymentId: 'pay_provider_1', amount: 1250, refundId: 'rfnd_0123456789ABCDEF' };
    await expect(razorpay.refund(request)).resolves.toEqual({ providerRefundId: 'rfnd_provider_1' });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_provider_1/refund');
    expect(options.headers['X-Refund-Idempotency']).toBe(request.refundId);
    expect(JSON.parse(options.body)).toEqual({
      amount: request.amount,
      receipt: request.refundId,
      notes: { onyx_refund_id: request.refundId },
    });
  });

  test('finds an existing refund using its stable receipt before an operator retries', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'rfnd_provider_2', receipt: 'rfnd_internal_2', status: 'processed', notes: {} }] }),
    });

    await expect(razorpay.lookupRefund({ providerPaymentId: 'pay_provider_1', refundId: 'rfnd_internal_2' }))
      .resolves.toEqual({ status: 'succeeded', providerRefundId: 'rfnd_provider_2' });
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.razorpay.com/v1/payments/pay_provider_1/refunds?count=100&skip=0');
  });

  test('reports not-found only after a complete provider page', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    await expect(razorpay.lookupRefund({ providerPaymentId: 'pay_provider_1', refundId: 'rfnd_missing' }))
      .resolves.toEqual({ status: 'not_found' });
  });
});
