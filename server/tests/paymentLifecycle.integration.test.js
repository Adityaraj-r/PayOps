const enabled = process.env.PAYOPS_INTEGRATION === '1';

(enabled ? describe : describe.skip)('payment lifecycle integration (MongoDB replica set + Redis)', () => {
  let merchant;
  let payment;
  let mongoose;
  let env;
  let paymentService;
  let providerEvents;
  let refundService;
  let ledger;
  let queues;
  let redis;
  let models;
  let crypto;

  beforeAll(async () => {
    mongoose = require('mongoose');
    env = require('../src/config/env');
    paymentService = require('../src/services/paymentService');
    providerEvents = require('../src/services/providerEventService');
    refundService = require('../src/services/refundService');
    ledger = require('../src/services/ledgerService');
    queues = require('../src/queues');
    redis = require('../src/config/redis');
    models = require('../src/models');
    crypto = require('../src/lib/crypto');

    await require('../src/config/db').connectDb(env.MONGO_URI);
    merchant = await models.Merchant.create({ name: 'Integration merchant', email: `integration-${Date.now()}@payops.test`, passwordHash: 'not-used' });
    await require('../src/config/db').withTransaction((session) => ledger.ensureAccounts(merchant._id, session));
  }, 30000);

  afterAll(async () => {
    if (queues) await queues.closeQueues();
    if (redis) await redis.closeRedis();
    if (mongoose?.connection?.readyState) await require('../src/config/db').disconnectDb();
  }, 30000);

  test('creates once, deduplicates and orders provider webhooks, refunds, and recovers a lost queue job', async () => {
    const createInput = { amount: 49900, currency: 'INR', customer: { email: 'buyer@example.test' } };
    const createKey = crypto.sha256('integration-payment-key');
    payment = await paymentService.createPayment(merchant, createInput, createKey);
    const paymentReplay = await paymentService.createPayment(merchant, createInput, createKey);
    expect(paymentReplay._id).toBe(payment._id);
    expect(await models.Payment.countDocuments({ merchantId: merchant._id, idempotencyKeyHash: createKey })).toBe(1);

    const concurrentKey = crypto.sha256('integration-concurrent-payment-key');
    const concurrentPayments = await Promise.all([
      paymentService.createPayment(merchant, createInput, concurrentKey),
      paymentService.createPayment(merchant, createInput, concurrentKey),
    ]);
    expect(concurrentPayments[0]._id).toBe(concurrentPayments[1]._id);
    expect(await models.Payment.countDocuments({ merchantId: merchant._id, idempotencyKeyHash: concurrentKey })).toBe(1);

    const providerPaymentId = `mb_pay_integration_${Date.now()}`;
    await models.MockProviderTxn.create({ _id: providerPaymentId, orderId: payment.providerOrderId, paymentId: payment._id, amount: payment.amount, status: 'captured', amountRefunded: 0 });
    const sendEvent = async (id, type, status) => {
      const raw = JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { payment_id: providerPaymentId, order_id: payment.providerOrderId, amount: payment.amount, status } });
      const signature = crypto.signWebhook(env.MOCKBANK_WEBHOOK_SECRET, raw);
      return providerEvents.ingest('mockbank', raw, { 'x-mockbank-signature': signature });
    };

    const capturedEvent = await sendEvent(`evt_capture_${payment._id}`, 'payment.captured', 'captured');
    const duplicate = await sendEvent(`evt_capture_${payment._id}`, 'payment.captured', 'captured');
    expect(capturedEvent.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    await providerEvents.processEvent(capturedEvent.id);
    expect((await models.Payment.findById(payment._id).lean()).status).toBe('captured');

    const lateAuthorized = await sendEvent(`evt_auth_late_${payment._id}`, 'payment.authorized', 'authorized');
    await providerEvents.processEvent(lateAuthorized.id);
    expect((await models.Payment.findById(payment._id).lean()).status).toBe('captured');

    const refundKey = crypto.sha256('integration-refund-key');
    const [refund, refundReplay] = await Promise.all([
      refundService.createRefund(merchant._id, payment._id, { amount: 1000, reason: 'integration test' }, refundKey),
      refundService.createRefund(merchant._id, payment._id, { amount: 1000, reason: 'integration test' }, refundKey),
    ]);
    expect(refundReplay._id).toBe(refund._id);
    expect(await models.Refund.countDocuments({ merchantId: merchant._id, idempotencyKeyHash: refundKey })).toBe(1);

    const refundQueue = queues.getQueue('refunds');
    const jobId = `${refund._id}-dispatch-${refund.dispatchVersion || 0}`;
    const queuedJob = await refundQueue.getJob(jobId);
    if (queuedJob) await queuedJob.remove();
    await models.Refund.updateOne({ _id: refund._id }, { $set: { createdAt: new Date(Date.now() - 120000) } }, { timestamps: false });
    await expect(refundService.requeuePending()).resolves.toEqual({ queued: 1 });
    expect(await refundQueue.getJob(jobId)).toBeTruthy();

    await refundService.processRefund(refund._id);
    const finalPayment = await models.Payment.findById(payment._id).lean();
    expect(finalPayment.amountRefunded).toBe(1000);
    expect(finalPayment.amountRefundPending).toBe(0);
    expect((await ledger.verifyIntegrity(merchant._id)).balanced).toBe(true);
  }, 30000);
});
