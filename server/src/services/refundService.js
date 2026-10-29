// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const logger = require('../config/logger');
const { withTransaction } = require('../config/db');
const { Payment, Refund } = require('../models');
const { REFUNDABLE_STATES } = require('../domain/paymentStateMachine');
const { postings } = require('../domain/ledger');
const { notFound, conflict, unprocessable } = require('../lib/errors');
const serialize = require('../lib/serialize');
const { getProvider } = require('../providers');
const { enqueue } = require('../queues');
const ledger = require('./ledgerService');
const outbox = require('./outboxService');
const { transition } = require('./paymentService');

const refundJobId = (refund) => `${refund._id}-dispatch-${refund.dispatchVersion || 0}`;

async function enqueueRefund(refund) {
  return enqueue('refunds', 'process', { refundId: refund._id }, { jobId: refundJobId(refund), attempts: 6, backoff: { type: 'exponential', delay: 3000 } });
}

/**
 * Reserves the refund amount atomically on the payment (amountRefundPending), so two
 * concurrent refunds can never exceed what was captured. The provider call happens
 * later in a worker with retries.
 */
async function createRefund(merchantId, paymentId, { amount, reason }, idempotencyKeyHash = null) {
  if (idempotencyKeyHash) {
    const existing = await Refund.findOne({ merchantId, idempotencyKeyHash }).lean();
    if (existing) {
      if (existing.status === 'pending' && !existing.needsAttention) {
        try { await enqueueRefund(existing); } catch (err) { logger.error({ refundId: existing._id, error: err.message }, 'Refund replay dispatch failed; recovery will requeue it'); }
      }
      return existing;
    }
  }
  const payment = await Payment.findOne({ _id: paymentId, merchantId }).lean();
  if (!payment) throw notFound(`No payment ${paymentId}`);
  if (!REFUNDABLE_STATES.includes(payment.status)) {
    throw unprocessable(`Only captured payments can be refunded; this one is ${payment.status}`, 'payment_not_refundable');
  }
  const remaining = payment.amount - payment.amountRefunded - payment.amountRefundPending;
  const refundAmount = amount ?? remaining;
  if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0 || refundAmount > remaining) {
    throw unprocessable(`Refund amount must be between 1 and ${remaining} paise`, 'refund_amount_invalid');
  }

  let refund;
  try {
    refund = await withTransaction(async (session) => {
      const reserved = await Payment.findOneAndUpdate(
        {
          _id: paymentId,
          status: { $in: REFUNDABLE_STATES },
          $expr: { $lte: [{ $add: ['$amountRefunded', '$amountRefundPending', refundAmount] }, '$amount'] },
        },
        { $inc: { amountRefundPending: refundAmount } },
        { new: true, session },
      );
      if (!reserved) throw conflict('Another refund changed the refundable amount; check the payment and retry', 'refund_conflict');
      const [r] = await Refund.create([{ paymentId, merchantId, amount: refundAmount, reason, status: 'pending', ...(idempotencyKeyHash ? { idempotencyKeyHash } : {}) }], { session });
      return r;
    });
  } catch (err) {
    if (err.code !== 11000 || !idempotencyKeyHash) throw err;
    refund = await Refund.findOne({ merchantId, idempotencyKeyHash }).lean();
    if (!refund) throw err;
  }

  try {
    await enqueueRefund(refund);
  } catch (err) {
    logger.error({ refundId: refund._id, error: err.message }, 'Refund committed but initial job dispatch failed; recovery will requeue it');
  }
  return refund;
}

async function processRefund(refundId) {
  const refund = await Refund.findById(refundId).lean();
  if (!refund || refund.status !== 'pending' || refund.needsAttention) return { skipped: true };
  const payment = await Payment.findById(refund.paymentId).lean();

  await Refund.updateOne({ _id: refundId }, { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } });
  // Throws on provider failure; BullMQ retries with exponential backoff.
  const { providerRefundId } = await getProvider(payment.provider).refund({
    providerPaymentId: payment.providerPaymentId,
    amount: refund.amount,
    refundId: refund._id,
  });

  return finalizeRefund(refundId, providerRefundId);
}

async function finalizeRefund(refundId, providerRefundId, operatorAction = null) {
  return withTransaction(async (session) => {
    const filter = operatorAction
      ? { _id: refundId, status: 'pending', needsAttention: true, 'resolutionCheck.checkedAt': operatorAction.checkedAt, 'resolutionCheck.status': 'succeeded' }
      : { _id: refundId, status: 'pending' };
    const r = await Refund.findOneAndUpdate(
      filter,
      {
        $set: { status: 'succeeded', providerRefundId, succeededAt: new Date(), needsAttention: false, resolutionCheck: null },
        ...(operatorAction ? { $push: { operatorActions: { ...operatorAction, action: 'mark_succeeded', previousState: 'needs_attention', resultingState: 'succeeded', providerStatus: 'succeeded', at: new Date() } } } : {}),
      },
      { new: true, session },
    );
    if (!r) return { skipped: true };

    const p = await Payment.findById(r.paymentId).session(session).lean();
    const to = p.amountRefunded + r.amount >= p.amount ? 'refunded' : 'partially_refunded';
    const t = await transition(p._id, to, {
      reason: `refund ${r._id}`,
      inc: { amountRefunded: r.amount, amountRefundPending: -r.amount },
      session,
      allowSame: true,
    });
    if (!t.changed) throw new Error(`Refund ${r._id} succeeded at provider but payment ${p._id} could not move: ${t.reason}`);

    await ledger.post({
      merchantId: r.merchantId,
      type: 'refund',
      ref: r._id,
      paymentId: p._id,
      idempotencyKey: `refund:${r._id}`,
      lines: postings.refund({ amount: r.amount }),
      session,
    });
    await outbox.enqueue({ merchantId: r.merchantId, type: 'refund.succeeded', objectId: r._id, data: serialize.refund(r), session });
    return { refundId: r._id, status: 'succeeded' };
  });
}

/** Finalize known rejections; preserve the reservation when the provider outcome is unknown. */
async function failRefund(refundId, errorMessage, { ambiguous = false } = {}) {
  if (ambiguous) {
    const result = await Refund.updateOne(
      { _id: refundId, status: 'pending' },
      { $set: { needsAttention: true, failureReason: errorMessage } },
    );
    if (result.modifiedCount) {
      logger.error({ refundId, error: errorMessage }, 'Refund outcome is unknown; reservation retained for reconciliation');
    }
    return { refundId, status: result.modifiedCount ? 'needs_attention' : 'skipped' };
  }

  return withTransaction(async (session) => {
    const r = await Refund.findOneAndUpdate(
      { _id: refundId, status: 'pending' },
      { $set: { status: 'failed', needsAttention: false, resolutionCheck: null, failureReason: errorMessage } },
      { new: true, session },
    );
    if (!r) return { skipped: true };
    await Payment.updateOne({ _id: r.paymentId }, { $inc: { amountRefundPending: -r.amount } }, { session });
    await outbox.enqueue({ merchantId: r.merchantId, type: 'refund.failed', objectId: r._id, data: serialize.refund(r), session });
    logger.error({ refundId, error: errorMessage }, 'Refund failed after all retries');
    return { refundId, status: 'failed' };
  });
}

async function listNeedsAttention({ limit = 100 } = {}) {
  return Refund.find({ status: 'pending', needsAttention: true }).sort({ updatedAt: 1 }).limit(limit).lean();
}

async function checkAmbiguousRefund(refundId, { operatorId, operatorEmail, reason }) {
  const refund = await Refund.findOne({ _id: refundId, status: 'pending', needsAttention: true }).lean();
  if (!refund) throw notFound('Ambiguous pending refund not found');
  const payment = await Payment.findById(refund.paymentId).lean();
  if (!payment?.providerPaymentId) throw unprocessable('The refund payment has no provider payment ID to verify', 'refund_provider_reference_missing');
  const provider = getProvider(payment.provider);
  let lookup;
  try {
    lookup = await provider.lookupRefund({ providerPaymentId: payment.providerPaymentId, refundId: refund._id });
  } catch (err) {
    logger.warn({ refundId, provider: provider.name }, 'Operator refund status lookup failed; leaving refund unresolved');
    lookup = { status: 'unknown' };
  }
  const checkedAt = new Date();
  const resolutionCheck = { status: lookup.status, provider: provider.name, providerPaymentId: payment.providerPaymentId, providerRefundId: lookup.providerRefundId, checkedAt };
  const action = { operatorId, operatorEmail, at: checkedAt, reason, action: 'status_checked', previousState: 'needs_attention', resultingState: 'needs_attention', providerStatus: lookup.status };
  const updated = await Refund.findOneAndUpdate(
    { _id: refundId, status: 'pending', needsAttention: true },
    { $set: { resolutionCheck }, $push: { operatorActions: action } },
    { new: true },
  ).lean();
  if (!updated) throw conflict('Refund state changed while checking provider status; reload and try again', 'refund_state_changed');
  return updated;
}

async function resolveAmbiguousRefund(refundId, { action, reason, operatorId, operatorEmail }) {
  const refund = await Refund.findOne({ _id: refundId, status: 'pending', needsAttention: true }).lean();
  if (!refund) throw notFound('Ambiguous pending refund not found');
  const check = refund.resolutionCheck;
  if (!check || Date.now() - new Date(check.checkedAt).getTime() > 5 * 60000) {
    throw unprocessable('Check the provider status again before resolving this refund', 'refund_status_check_required');
  }
  if (action === 'mark_succeeded' && (check.status !== 'succeeded' || !check.providerRefundId)) throw unprocessable('Provider status does not confirm a successful refund', 'refund_provider_status_mismatch');
  if (action === 'mark_failed' && check.status !== 'failed') throw unprocessable('Provider status does not confirm a failed refund', 'refund_provider_status_mismatch');
  if (action === 'retry' && check.status !== 'not_found') throw unprocessable('Retry is allowed only after the provider confirms no matching refund exists', 'refund_provider_status_mismatch');
  if (!['mark_succeeded', 'mark_failed', 'retry'].includes(action)) throw unprocessable('Unsupported refund resolution action', 'refund_action_invalid');
  const payment = await Payment.findById(refund.paymentId).lean();
  if (!payment?.providerPaymentId || check.provider !== getProvider(payment.provider).name || check.providerPaymentId !== payment.providerPaymentId) {
    throw unprocessable('Provider reference changed; check the provider status again', 'refund_status_check_required');
  }
  if (action === 'mark_succeeded') {
    return finalizeRefund(refundId, check.providerRefundId, { operatorId, operatorEmail, reason, checkedAt: check.checkedAt });
  }
  if (action === 'mark_failed') {
    return withTransaction(async (session) => {
      const r = await Refund.findOneAndUpdate(
        { _id: refundId, status: 'pending', needsAttention: true, 'resolutionCheck.checkedAt': check.checkedAt, 'resolutionCheck.status': 'failed' },
        {
          $set: { status: 'failed', needsAttention: false, resolutionCheck: null, failureReason: 'provider_confirmed_failed' },
          $push: { operatorActions: { operatorId, operatorEmail, at: new Date(), reason, action: 'mark_failed', previousState: 'needs_attention', resultingState: 'failed', providerStatus: 'failed' } },
        },
        { new: true, session },
      );
      if (!r) throw conflict('Refund state changed while resolving; reload and try again', 'refund_state_changed');
      const paymentUpdate = await Payment.updateOne({ _id: r.paymentId, amountRefundPending: { $gte: r.amount } }, { $inc: { amountRefundPending: -r.amount } }, { session });
      if (paymentUpdate.modifiedCount !== 1) throw conflict('Refund reservation changed; operator action was rolled back', 'refund_reservation_changed');
      await outbox.enqueue({ merchantId: r.merchantId, type: 'refund.failed', objectId: r._id, data: serialize.refund(r), session });
      return { refundId: r._id, status: 'failed' };
    });
  }
  if (action === 'retry') {
    const retried = await withTransaction(async (session) => {
      const r = await Refund.findOneAndUpdate(
        { _id: refundId, status: 'pending', needsAttention: true, 'resolutionCheck.checkedAt': check.checkedAt, 'resolutionCheck.status': 'not_found' },
        {
          $set: { needsAttention: false, resolutionCheck: null, lastAttemptAt: null },
          $inc: { dispatchVersion: 1 },
          $push: { operatorActions: { operatorId, operatorEmail, at: new Date(), reason, action: 'retry', previousState: 'needs_attention', resultingState: 'pending', providerStatus: 'not_found' } },
        },
        { new: true, session },
      );
      if (!r) throw conflict('Refund state changed while resolving; reload and try again', 'refund_state_changed');
      return r;
    });
    try {
      await enqueueRefund(retried);
    } catch (err) {
      logger.error({ refundId, error: err.message }, 'Operator-approved refund retry committed but job dispatch failed; recovery will requeue it');
    }
    return { refundId: retried._id, status: 'pending', dispatchVersion: retried.dispatchVersion };
  }
}

/** Re-enqueue committed pending refunds after Redis outages or lost dispatches. Stable job IDs make this safe. */
async function requeuePending() {
  const cutoff = new Date(Date.now() - 60000);
  const pending = await Refund.find({
    status: 'pending',
    needsAttention: false,
    createdAt: { $lt: cutoff },
    $or: [{ lastAttemptAt: null }, { lastAttemptAt: { $lt: cutoff } }],
  }, { _id: 1, dispatchVersion: 1 }).sort({ createdAt: 1 }).limit(100).lean();
  let queued = 0;
  for (const refund of pending) {
    try {
      await enqueueRefund(refund);
      queued += 1;
    } catch (err) {
      logger.error({ refundId: refund._id, error: err.message }, 'Pending refund recovery dispatch failed');
    }
  }
  return { queued };
}

/** Flags refunds stuck in pending so an operator can look. Never re-sends money automatically. */
async function flagStuckRefunds() {
  const cutoff = new Date(Date.now() - 15 * 60000);
  const res = await Refund.updateMany({ status: 'pending', createdAt: { $lt: cutoff }, needsAttention: false }, { $set: { needsAttention: true } });
  return { flagged: res.modifiedCount };
}

async function listForPayment(merchantId, paymentId) {
  return Refund.find({ merchantId, paymentId }).sort({ createdAt: -1 }).lean();
}

module.exports = { createRefund, processRefund, failRefund, flagStuckRefunds, listForPayment, listNeedsAttention, checkAmbiguousRefund, resolveAmbiguousRefund, requeuePending };
