// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const env = require('../config/env');
const { Payment, Merchant, ReconciliationReport } = require('../models');
const { CAPTURED_STATES } = require('../domain/paymentStateMachine');
const { activeProvider } = require('../providers');
const ledger = require('./ledgerService');

const MAX_ITEMS = 200;
const ourCaptured = (status) => CAPTURED_STATES.includes(status);

/**
 * Three-way check:
 *   1. PayOps payments vs the provider's own records (amounts and statuses)
 *   2. Every merchant ledger: stored balances vs balances recomputed from the journal
 *   3. Debits equal credits
 */
async function run({ windowHours = 72, trigger = 'schedule' } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - windowHours * 3600000);
  const provider = activeProvider();

  const remote = await provider.listPayments({ from, to });
  const remoteById = new Map(remote.map((r) => [r.providerPaymentId, r]));
  const ours = await Payment.find({ provider: provider.name, providerPaymentId: { $ne: null }, createdAt: { $gte: new Date(from.getTime() - 3600000) } }).lean();
  const oursById = new Map(ours.map((p) => [p.providerPaymentId, p]));

  const buckets = { matched: 0, amountMismatch: [], statusMismatch: [], missingAtProvider: [], missingInOnyx: [] };
  const merchantCounts = new Map();
  const countsFor = (merchantId) => {
    if (!merchantCounts.has(merchantId)) merchantCounts.set(merchantId, { merchantId, matched: 0, amountMismatch: 0, statusMismatch: 0, missingAtProvider: 0 });
    return merchantCounts.get(merchantId);
  };
  const item = (p, r) => ({
    merchantId: p?.merchantId,
    paymentId: p?._id,
    providerPaymentId: p?.providerPaymentId || r?.providerPaymentId,
    ourStatus: p?.status,
    providerStatus: r?.status,
    ourAmount: p?.amount,
    providerAmount: r?.amount,
  });

  for (const p of ours) {
    const counts = countsFor(p.merchantId);
    const r = remoteById.get(p.providerPaymentId);
    if (!r) {
      if (ourCaptured(p.status)) {
        buckets.missingAtProvider.push(item(p, null));
        counts.missingAtProvider += 1;
      }
      continue;
    }
    if (r.amount !== p.amount) {
      buckets.amountMismatch.push(item(p, r));
      counts.amountMismatch += 1;
    } else if ((r.status === 'captured') !== ourCaptured(p.status) && !['processing', 'authorized'].includes(p.status)) {
      buckets.statusMismatch.push(item(p, r));
      counts.statusMismatch += 1;
    } else {
      buckets.matched += 1;
      counts.matched += 1;
    }
  }
  for (const r of remote) {
    if (r.status === 'captured' && !oursById.has(r.providerPaymentId)) buckets.missingInOnyx.push(item(null, r));
  }

  const merchants = await Merchant.find({}, { _id: 1 }).lean();
  const ledgerChecks = [];
  for (const { _id } of merchants) {
    const check = await ledger.verifyIntegrity(_id);
    ledgerChecks.push({ merchantId: _id, balanced: check.balanced, totalDebits: check.totalDebits, totalCredits: check.totalCredits, driftAccounts: check.driftAccounts });
  }

  return ReconciliationReport.create({
    provider: provider.name,
    from,
    to,
    trigger,
    counts: {
      matched: buckets.matched,
      amountMismatch: buckets.amountMismatch.length,
      statusMismatch: buckets.statusMismatch.length,
      missingAtProvider: buckets.missingAtProvider.length,
      missingInOnyx: buckets.missingInOnyx.length,
    },
    merchantCounts: [...merchantCounts.values()],
    amountMismatch: buckets.amountMismatch.slice(0, MAX_ITEMS),
    statusMismatch: buckets.statusMismatch.slice(0, MAX_ITEMS),
    missingAtProvider: buckets.missingAtProvider.slice(0, MAX_ITEMS),
    missingInOnyx: buckets.missingInOnyx.slice(0, MAX_ITEMS),
    ledgerChecks,
  });
}

/** Merchant view of the latest report: only their rows and their ledger. */
async function latestForMerchant(merchantId, limit = 10) {
  const reports = await ReconciliationReport.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  const mine = (rows) => (rows || []).filter((r) => r.merchantId === merchantId);
  return reports.map((r) => {
    const amountMismatch = mine(r.amountMismatch);
    const statusMismatch = mine(r.statusMismatch);
    const missingAtProvider = mine(r.missingAtProvider);
    const ledgerCheck = (r.ledgerChecks || []).find((c) => c.merchantId === merchantId) || null;
    const counts = (r.merchantCounts || []).find((c) => c.merchantId === merchantId);
    const merchantIssueCounts = {
      amount_mismatch: counts?.amountMismatch ?? amountMismatch.length,
      status_mismatch: counts?.statusMismatch ?? statusMismatch.length,
      missing_at_provider: counts?.missingAtProvider ?? missingAtProvider.length,
    };
    const issueCount = Object.values(merchantIssueCounts).reduce((sum, count) => sum + count, 0);
    return {
      id: r._id,
      provider: r.provider,
      trigger: r.trigger,
      window: { from: r.from, to: r.to },
      created_at: r.createdAt,
      matched_count: counts?.matched ?? null,
      issues: { amount_mismatch: amountMismatch, status_mismatch: statusMismatch, missing_at_provider: missingAtProvider },
      issue_counts: merchantIssueCounts,
      issue_count: issueCount,
      issues_truncated: issueCount > amountMismatch.length + statusMismatch.length + missingAtProvider.length,
      ledger: ledgerCheck,
    };
  });
}

module.exports = { run, latestForMerchant, intervalMs: () => env.RECONCILIATION_INTERVAL_SECONDS * 1000 };
