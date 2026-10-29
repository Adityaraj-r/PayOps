const { Payment } = require('../src/models');
const risk = require('../src/services/riskService');

jest.mock('../src/models', () => ({ Payment: { findOne: jest.fn() } }));
jest.mock('../src/services/riskService', () => ({ assess: jest.fn(), recordPayment: jest.fn(), recordFailure: jest.fn() }));

const payments = require('../src/services/paymentService');

describe('payment operation idempotency', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the payment already created for the same merchant idempotency identity', async () => {
    const existing = { _id: 'pay_existing', merchantId: 'mer_1', status: 'created' };
    Payment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(existing) });

    const result = await payments.createPayment({ _id: 'mer_1' }, { amount: 100, customer: { email: 'buyer@example.test' } }, 'stable-key-hash');

    expect(result).toBe(existing);
    expect(Payment.findOne).toHaveBeenCalledWith({ merchantId: 'mer_1', idempotencyKeyHash: 'stable-key-hash' });
    expect(risk.assess).not.toHaveBeenCalled();
  });
});
