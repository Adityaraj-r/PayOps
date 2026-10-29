const { getRedis } = require('../src/config/redis');
jest.mock('../src/config/redis', () => ({ getRedis: jest.fn() }));

const rateLimit = require('../src/middleware/rateLimit');

describe('rate limit Redis outage policy', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fails closed when configured for sensitive production routes', async () => {
    getRedis.mockReturnValue({ eval: jest.fn().mockRejectedValue(new Error('redis unavailable')) });
    const next = jest.fn();
    await rateLimit({ failOpen: false })({ ip: '127.0.0.1' }, { set: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503, code: 'service_unavailable' }));
  });

  test('can fail open only when explicitly configured', async () => {
    getRedis.mockReturnValue({ eval: jest.fn().mockRejectedValue(new Error('redis unavailable')) });
    const next = jest.fn();
    await rateLimit({ failOpen: true })({ ip: '127.0.0.1' }, { set: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith();
  });
});
