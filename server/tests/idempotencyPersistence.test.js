const { IdempotencyRecord } = require('../src/models');
const { getRedis } = require('../src/config/redis');

jest.mock('../src/models', () => ({ IdempotencyRecord: { create: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));
jest.mock('../src/config/redis', () => ({ getRedis: jest.fn() }));

const idempotency = require('../src/middleware/idempotency');

describe('idempotency response persistence', () => {
  beforeEach(() => jest.clearAllMocks());

  test('withholds a successful response if the durable response record cannot be stored', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
    getRedis.mockReturnValue(redis);
    IdempotencyRecord.create.mockResolvedValue({ _id: 'idem_1' });
    IdempotencyRecord.updateOne.mockRejectedValue(new Error('database unavailable'));

    const req = {
      method: 'POST', baseUrl: '/v1', path: '/payments', body: { amount: 100 },
      merchant: { _id: 'mer_1' }, get: () => 'request-1',
    };
    const originalJson = jest.fn().mockImplementation(function send() { this.headersSent = true; return this; });
    const res = {
      statusCode: 201, headersSent: false, set: jest.fn(), status: jest.fn(function status(code) { this.statusCode = code; return this; }),
      json: originalJson,
    };
    const next = jest.fn();

    await idempotency()(req, res, next);
    expect(req.idempotencyKeyHash).toEqual(expect.any(String));
    res.json({ id: 'pay_1' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(originalJson).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'idempotency_persistence_failed' }) }));
    expect(res.statusCode).toBe(503);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
