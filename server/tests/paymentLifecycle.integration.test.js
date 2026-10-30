const enabled = process.env.PAYOPS_INTEGRATION === '1';

if (process.env.CI === 'true' && !enabled) {
  throw new Error('CI must set PAYOPS_INTEGRATION=1; do not silently skip payment lifecycle integration tests');
}

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
    // Refund retries are tested elsewhere; keep this lifecycle integration deterministic.
    process.env.MOCKBANK_REFUND_FAILURE_RATE = '0';
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
    // Ensure declared unique indexes are active before concurrency/idempotency assertions.
    await Promise.all(Object.values(models).map((model) => model.init()));
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
    await models.Refund.collection.updateOne({ _id: refund._id }, { $set: { createdAt: new Date(Date.now() - 120000) } });
    await expect(refundService.requeuePending()).resolves.toEqual({ queued: 1 });
    expect(await refundQueue.getJob(jobId)).toBeTruthy();

    await refundService.processRefund(refund._id);
    const finalPayment = await models.Payment.findById(payment._id).lean();
    expect(finalPayment.amountRefunded).toBe(1000);
    expect(finalPayment.amountRefundPending).toBe(0);
    expect((await ledger.verifyIntegrity(merchant._id)).balanced).toBe(true);

    const concurrentRefunds = await Promise.allSettled([
      refundService.createRefund(merchant._id, payment._id, { amount: 25000, reason: 'concurrent A' }, crypto.sha256('integration-refund-concurrent-a')),
      refundService.createRefund(merchant._id, payment._id, { amount: 25000, reason: 'concurrent B' }, crypto.sha256('integration-refund-concurrent-b')),
    ]);
    expect(concurrentRefunds.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentRefunds.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const afterConcurrentRefunds = await models.Payment.findById(payment._id).lean();
    expect(afterConcurrentRefunds.amountRefunded + afterConcurrentRefunds.amountRefundPending).toBeLessThanOrEqual(afterConcurrentRefunds.amount);
  }, 30000);

  test('checkout capabilities expire on read and pending webhook jobs recover after loss/restart', async () => {
    const checkoutPayment = await paymentService.createPayment(merchant, {
      amount: 1200, currency: 'INR', customer: { email: 'checkout-expiry@example.test' },
    });
    await models.Payment.updateOne({ _id: checkoutPayment._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(paymentService.getCheckout(checkoutPayment._id, checkoutPayment.clientSecret)).rejects.toMatchObject({ code: 'payment_expired' });
    expect((await models.Payment.findById(checkoutPayment._id).lean()).status).toBe('expired');

    const delivery = await models.WebhookDelivery.create({
      merchantId: merchant._id, endpointId: 'endpoint-recovery-test', eventId: `event-${Date.now()}`,
      eventType: 'payment.captured', objectId: checkoutPayment._id, url: 'https://example.test/hook', status: 'pending',
    });
    const webhookService = require('../src/services/webhookService');
    const queue = queues.getQueue('webhooks');
    await webhookService.requeuePendingDeliveries();
    expect(await queue.getJob(delivery._id)).toBeTruthy();

    // Model Redis loss or a restart that removed the waiting job; the durable Mongo record is sufficient to restore it.
    await (await queue.getJob(delivery._id)).remove();
    await webhookService.requeuePendingDeliveries();
    expect(await queue.getJob(delivery._id)).toBeTruthy();
    // A second recovery pass observes the stable active/waiting job and does not duplicate it.
    await webhookService.requeuePendingDeliveries();
    expect(await queue.getJob(delivery._id)).toBeTruthy();
    await (await queue.getJob(delivery._id)).remove();
    await models.WebhookDelivery.deleteOne({ _id: delivery._id });
  }, 30000);

  test('a webhook delivery claim prevents concurrent duplicate processing', async () => {
    const endpoint = await models.WebhookEndpoint.create({
      merchantId: merchant._id, url: 'https://example.test/hook', secret: 'synthetic-secret', active: false,
    });
    const delivery = await models.WebhookDelivery.create({
      merchantId: merchant._id, endpointId: endpoint._id, eventId: `event-${Date.now()}`,
      eventType: 'payment.captured', objectId: 'payment-test', url: endpoint.url, status: 'pending',
    });
    const webhookService = require('../src/services/webhookService');
    await Promise.all([
      webhookService.deliver(delivery._id),
      webhookService.deliver(delivery._id),
    ]);
    expect((await models.WebhookDelivery.findById(delivery._id).lean()).status).toBe('failed');
    await models.WebhookDelivery.deleteOne({ _id: delivery._id });
    await models.WebhookEndpoint.deleteOne({ _id: endpoint._id });
  }, 30000);

  test('posted journal entries reject Mongoose updates and deletion while preserving balanced records', async () => {
    const entry = await models.JournalEntry.create({
      merchantId: merchant._id,
      type: 'capture',
      ref: `immutability-${Date.now()}`,
      idempotencyKey: `immutability-${Date.now()}`,
      lines: [
        { account: 'provider_receivable', direction: 'debit', amount: 100 },
        { account: 'merchant_payable', direction: 'credit', amount: 100 },
      ],
    });

    await expect(models.JournalEntry.updateOne({ _id: entry._id }, { $set: { ref: 'changed' } })).rejects.toThrow(/immutable/i);
    await expect(models.JournalEntry.findOneAndUpdate({ _id: entry._id }, { $set: { ref: 'changed' } })).rejects.toThrow(/immutable/i);
    await expect(models.JournalEntry.deleteOne({ _id: entry._id })).rejects.toThrow(/immutable/i);
    await expect(models.JournalEntry.deleteMany({ _id: entry._id })).rejects.toThrow(/immutable/i);
    await expect(models.JournalEntry.bulkWrite([{ updateOne: { filter: { _id: entry._id }, update: { $set: { ref: 'changed' } } } }])).rejects.toThrow(/insert new entries/i);

    const loaded = await models.JournalEntry.findById(entry._id);
    loaded.ref = 'changed';
    await expect(loaded.save()).rejects.toThrow(/immutable/i);
    await expect(loaded.deleteOne()).rejects.toThrow(/immutable/i);

    const stored = await models.JournalEntry.findById(entry._id).lean();
    expect(stored.ref).toBe(entry.ref);
    expect(stored.lines.reduce((sum, line) => sum + (line.direction === 'debit' ? line.amount : -line.amount), 0)).toBe(0);
  }, 30000);

  test('worker reclaims a stale processing delivery when its lease field is missing', async () => {
    const endpoint = await models.WebhookEndpoint.create({
      merchantId: merchant._id, url: 'https://example.test/hook', secret: 'synthetic-secret', active: false,
    });
    const delivery = await models.WebhookDelivery.create({
      merchantId: merchant._id, endpointId: endpoint._id, eventId: `event-missing-lease-${Date.now()}`,
      eventType: 'payment.captured', objectId: 'payment-test', url: endpoint.url, status: 'processing',
    });
    await models.WebhookDelivery.collection.updateOne(
      { _id: delivery._id },
      { $unset: { leaseUntil: 1 }, $set: { updatedAt: new Date(Date.now() - 120000) } },
    );

    const webhookService = require('../src/services/webhookService');
    const queue = queues.getQueue('webhooks');
    const recovered = await webhookService.requeuePendingDeliveries();
    expect(recovered.queued).toBeGreaterThanOrEqual(1);
    const job = await queue.getJob(delivery._id);
    expect(job).toBeTruthy();

    await webhookService.deliver(delivery._id);
    expect((await models.WebhookDelivery.findById(delivery._id).lean()).status).toBe('failed');
    await job.remove();
    await models.WebhookDelivery.deleteOne({ _id: delivery._id });
    await models.WebhookEndpoint.deleteOne({ _id: endpoint._id });
  }, 30000);
});
