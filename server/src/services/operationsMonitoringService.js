// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const env = require('../config/env');
const logger = require('../config/logger');
const { QUEUES, getQueue } = require('../queues');
const { Refund, ReconciliationReport, WebhookEndpoint } = require('../models');

async function snapshot() {
  const queueStats = {};
  for (const queueName of Object.values(QUEUES)) {
    const queue = getQueue(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const waiting = await queue.getJobs(['waiting', 'delayed'], 0, 99, true);
    const oldestAgeSeconds = waiting.reduce((age, job) => Math.max(age, Math.floor((Date.now() - job.timestamp) / 1000)), 0);
    queueStats[queueName] = { ...counts, oldestAgeSeconds };
    if (counts.failed || oldestAgeSeconds >= env.OPS_QUEUE_WARN_AGE_SECONDS) {
      logger.warn({ queue: queueName, ...queueStats[queueName] }, 'Operational alert: background queue is failing or delayed');
    }
  }

  const [refundsNeedingAttention, overdueRefunds, latestReport, expiredWebhookSecrets] = await Promise.all([
    Refund.countDocuments({ status: 'pending', needsAttention: true }),
    Refund.countDocuments({ status: 'pending', needsAttention: false, createdAt: { $lt: new Date(Date.now() - 15 * 60000) } }),
    ReconciliationReport.findOne({}).sort({ createdAt: -1 }).lean(),
    WebhookEndpoint.updateMany({ previousSecretExpiresAt: { $lte: new Date() } }, { $unset: { previousSecret: 1, previousSecretExpiresAt: 1 } }),
  ]);
  if (refundsNeedingAttention || overdueRefunds) {
    logger.error({ refundsNeedingAttention, overdueRefunds }, 'Operational alert: refunds require investigation or dispatch recovery');
  }

  const reconciliation = latestReport ? {
    ageSeconds: Math.floor((Date.now() - new Date(latestReport.createdAt).getTime()) / 1000),
    counts: latestReport.counts,
  } : { ageSeconds: null, counts: null };
  if (reconciliation.ageSeconds == null || reconciliation.ageSeconds > env.OPS_RECONCILIATION_STALE_SECONDS) {
    logger.warn({ ...reconciliation }, 'Operational alert: reconciliation report is missing or stale');
  } else if (Object.entries(reconciliation.counts || {}).some(([key, value]) => key !== 'matched' && value > 0)) {
    logger.warn({ ...reconciliation }, 'Operational alert: latest reconciliation found provider or ledger issues');
  }

  const result = { queues: queueStats, refunds: { needsAttention: refundsNeedingAttention, overdue: overdueRefunds }, reconciliation, expiredWebhookSecretsCleared: expiredWebhookSecrets.modifiedCount };
  logger.info(result, 'Operational health snapshot');
  return result;
}

module.exports = { snapshot };
