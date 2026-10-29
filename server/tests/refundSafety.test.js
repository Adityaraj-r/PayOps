const { isAmbiguousRefundError } = require('../src/worker');

describe('exhausted refund errors', () => {
  test('keeps the reservation for timeouts and provider server errors', () => {
    expect(isAmbiguousRefundError(new Error('request timed out'))).toBe(true);
    expect(isAmbiguousRefundError(Object.assign(new Error('provider error'), { status: 503 }))).toBe(true);
  });

  test('keeps the reservation while the provider reports an operation in progress', () => {
    expect(isAmbiguousRefundError(Object.assign(new Error('still processing'), { status: 409 }))).toBe(true);
  });

  test('releases only after a definitive rejection', () => {
    expect(isAmbiguousRefundError(Object.assign(new Error('invalid request'), { status: 400 }))).toBe(false);
    expect(isAmbiguousRefundError(Object.assign(new Error('simulated rejection'), { refundDefinitelyNotApplied: true }))).toBe(false);
  });
});
