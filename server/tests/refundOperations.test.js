const db = require('../src/config/db');
const models = require('../src/models');
const providerModule = require('../src/providers');
const queues = require('../src/queues');

jest.mock('../src/config/db', () => ({ withTransaction: jest.fn(async (fn) => fn({})) }));
jest.mock('../src/models', () => ({
  Payment: { findById: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() },
  Refund: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), find: jest.fn() },
}));
jest.mock('../src/providers', () => ({ getProvider: jest.fn() }));
jest.mock('../src/queues', () => ({ enqueue: jest.fn() }));

const refunds = require('../src/services/refundService');

describe('operator refund resolution', () => {
  const operator = { operatorId: 'mer_ops', operatorEmail: 'operator@payops.test' };

  beforeEach(() => jest.clearAllMocks());

  test('checks provider status and records the operator, reason, and state transition', async () => {
    const refund = { _id: 'rfnd_1', paymentId: 'pay_1', status: 'pending', needsAttention: true };
    const payment = { provider: 'mockbank', providerPaymentId: 'mb_pay_1' };
    const checked = { ...refund, resolutionCheck: { status: 'not_found', provider: 'mockbank', providerPaymentId: 'mb_pay_1', checkedAt: new Date() } };
    models.Refund.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(refund) });
    models.Payment.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(payment) });
    providerModule.getProvider.mockReturnValue({ name: 'mockbank', lookupRefund: jest.fn().mockResolvedValue({ status: 'not_found' }) });
    models.Refund.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(checked) });

    await refunds.checkAmbiguousRefund('rfnd_1', { ...operator, reason: 'Verify provider after timeout' });

    expect(providerModule.getProvider().lookupRefund).toHaveBeenCalledWith({ providerPaymentId: 'mb_pay_1', refundId: 'rfnd_1' });
    expect(models.Refund.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: 'rfnd_1', status: 'pending', needsAttention: true });
    expect(models.Refund.findOneAndUpdate.mock.calls[0][1].$push.operatorActions).toMatchObject({
      operatorId: operator.operatorId,
      operatorEmail: operator.operatorEmail,
      reason: 'Verify provider after timeout',
      action: 'status_checked',
      previousState: 'needs_attention',
      resultingState: 'needs_attention',
      providerStatus: 'not_found',
    });
  });

  test('retries only after a fresh not-found check and dispatches a versioned job', async () => {
    const checkedAt = new Date();
    models.Refund.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: 'rfnd_1', status: 'pending', needsAttention: true,
      resolutionCheck: { status: 'not_found', provider: 'mockbank', providerPaymentId: 'mb_pay_1', checkedAt },
    }) });
    models.Payment.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ provider: 'mockbank', providerPaymentId: 'mb_pay_1' }) });
    providerModule.getProvider.mockReturnValue({ name: 'mockbank' });
    models.Refund.findOneAndUpdate.mockResolvedValue({ _id: 'rfnd_1', dispatchVersion: 1 });
    queues.enqueue.mockResolvedValue({});

    await expect(refunds.resolveAmbiguousRefund('rfnd_1', { ...operator, action: 'retry', reason: 'Provider has no refund record' }))
      .resolves.toMatchObject({ status: 'pending', dispatchVersion: 1 });

    expect(db.withTransaction).toHaveBeenCalled();
    expect(queues.enqueue).toHaveBeenCalledWith('refunds', 'process', { refundId: 'rfnd_1' }, expect.objectContaining({ jobId: 'rfnd_1-dispatch-1' }));
    expect(models.Refund.findOneAndUpdate.mock.calls[0][1].$push.operatorActions).toMatchObject({
      operatorId: operator.operatorId,
      action: 'retry',
      previousState: 'needs_attention',
      resultingState: 'pending',
    });
  });

  test('refuses to retry when provider status is unknown', async () => {
    models.Refund.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: 'rfnd_1', status: 'pending', needsAttention: true,
      resolutionCheck: { status: 'unknown', provider: 'mockbank', providerPaymentId: 'mb_pay_1', checkedAt: new Date() },
    }) });

    await expect(refunds.resolveAmbiguousRefund('rfnd_1', { ...operator, action: 'retry', reason: 'Attempt safe retry' }))
      .rejects.toMatchObject({ status: 422, code: 'refund_provider_status_mismatch' });
    expect(models.Refund.findOneAndUpdate).not.toHaveBeenCalled();
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  test('recovery re-enqueues pending refunds with their stable dispatch version', async () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'rfnd_2', dispatchVersion: 3 }]),
    };
    models.Refund.find.mockReturnValue(query);
    queues.enqueue.mockResolvedValue({});

    await expect(refunds.requeuePending()).resolves.toEqual({ queued: 1 });

    expect(models.Refund.find).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', needsAttention: false }), expect.any(Object));
    expect(queues.enqueue).toHaveBeenCalledWith('refunds', 'process', { refundId: 'rfnd_2' }, expect.objectContaining({ jobId: 'rfnd_2-dispatch-3' }));
  });

  test('replaying a refund idempotency identity returns the original reservation', async () => {
    const existing = { _id: 'rfnd_existing', merchantId: 'mer_1', status: 'pending', dispatchVersion: 0 };
    models.Refund.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(existing) });
    queues.enqueue.mockResolvedValue({});

    const result = await refunds.createRefund('mer_1', 'pay_1', { amount: 500 }, 'stable-key-hash');

    expect(result).toBe(existing);
    expect(models.Payment.findOne).not.toHaveBeenCalled();
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });
});
