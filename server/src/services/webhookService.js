// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const env = require('../config/env');
const logger = require('../config/logger');
const { OutboxEvent, WebhookEndpoint, WebhookDelivery } = require('../models');
const { signWebhook } = require('../lib/crypto');
const { newId, randomString } = require('../lib/ids');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { enqueue } = require('../queues');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { encryptWebhookSecret, decryptWebhookSecret, isEncryptedWebhookSecret } = require('../lib/webhookSecretCrypto');

const ipv4BlockedRanges = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, prefix]) => {
  const value = base.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n);
  const mask = (0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn;
  return { value, mask };
});
const blockedAddresses = new net.BlockList();
[
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].forEach(([address, prefix]) => blockedAddresses.addSubnet(address, prefix, 'ipv6'));
const ipv6GlobalUnicast = new net.BlockList();
ipv6GlobalUnicast.addSubnet('2000::', 3, 'ipv6');

function isPublicAddress(address, family = net.isIP(address)) {
  if (family === 4) {
    const value = address.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n);
    return !ipv4BlockedRanges.some(({ value: base, mask }) => (value & mask) === (base & mask));
  }
  if (family === 6) return ipv6GlobalUnicast.check(address, 'ipv6') && !blockedAddresses.check(address, 'ipv6');
  return false;
}

async function resolvePublicAddresses(hostname, lookup = dns.promises.lookup) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw badRequest('Webhook URL cannot resolve to a private or reserved address');
  }
  return addresses;
}

/** DNS is checked at registration and again by the socket lookup at connection time. */
async function assertDeliverableUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Webhook URL is not a valid URL');
  }
  if (url.username || url.password) throw badRequest('Webhook URL cannot include credentials');
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Webhook URL must use http or https');
  if (!env.ENABLE_DEV_ROUTES) {
    if (url.protocol !== 'https:') throw badRequest('Webhook URL must use https');
    try {
      await resolvePublicAddresses(url.hostname.replace(/^\[|\]$/g, ''));
    } catch (err) {
      if (err.status) throw err;
      throw badRequest('Webhook URL hostname could not be resolved safely');
    }
  }
  return url.toString();
}

async function createEndpoint(merchantId, { url, events = ['*'], description }) {
  const secret = `whsec_${randomString(32)}`;
  const endpoint = await WebhookEndpoint.create({ merchantId, url: await assertDeliverableUrl(url), events, description, secret: encryptWebhookSecret(secret), secretPreview: `${secret.slice(0, 10)}…` });
  return { ...endpoint.toObject(), secret };
}

async function rotateEndpointSecret(merchantId, endpointId) {
  const now = new Date();
  const current = await WebhookEndpoint.findOne({ _id: endpointId, merchantId }).lean();
  if (!current) throw notFound('Webhook endpoint not found');
  if (current.previousSecretExpiresAt && current.previousSecretExpiresAt > now) {
    throw conflict('This webhook endpoint is already rotating a secret; retry after the 24-hour overlap', 'webhook_secret_rotation_in_progress');
  }
  const secret = `whsec_${randomString(32)}`;
  const endpoint = await WebhookEndpoint.findOneAndUpdate(
    { _id: endpointId, merchantId, secret: current.secret },
    { $set: {
      previousSecret: isEncryptedWebhookSecret(current.secret) ? current.secret : encryptWebhookSecret(current.secret),
      previousSecretExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      secret: encryptWebhookSecret(secret),
      secretPreview: `${secret.slice(0, 10)}…`,
      secretRotatedAt: now,
    } },
    { new: true },
  ).lean();
  if (!endpoint) {
    throw conflict('Webhook secret changed concurrently; reload and retry', 'webhook_secret_rotation_conflict');
  }
  return { ...endpoint, secret };
}

function postWebhook(url, body, headers) {
  const target = new URL(url);
  const transport = target.protocol === 'https:' ? https : http;
  const options = { method: 'POST', headers, signal: AbortSignal.timeout(env.WEBHOOK_TIMEOUT_MS) };
  if (!env.ENABLE_DEV_ROUTES) {
    options.lookup = (hostname, lookupOptions, callback) => {
      resolvePublicAddresses(hostname.replace(/^\[|\]$/g, '')).then((addresses) => {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      }).catch((err) => callback(err));
    };
  }
  return new Promise((resolve, reject) => {
    const req = transport.request(target, options, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function deleteEndpoint(merchantId, endpointId) {
  const res = await WebhookEndpoint.deleteOne({ _id: endpointId, merchantId });
  if (!res.deletedCount) throw notFound('Webhook endpoint not found');
}

/**
 * Outbox relay. Fan-out is idempotent: the unique (eventId, endpointId) index stops
 * duplicate deliveries and jobId stops duplicate jobs, so a crash mid-relay is harmless.
 */
async function relayOutbox(limit = 100) {
  const events = await OutboxEvent.find({ published: false }).sort({ createdAt: 1 }).limit(limit).lean();
  for (const ev of events) {
    const endpoints = await WebhookEndpoint.find({ merchantId: ev.merchantId, active: true, $or: [{ events: '*' }, { events: ev.type }] }).lean();
    for (const ep of endpoints) {
      let delivery;
      try {
        delivery = await WebhookDelivery.create({ merchantId: ev.merchantId, endpointId: ep._id, eventId: ev._id, eventType: ev.type, objectId: ev.objectId, url: ep.url });
      } catch (err) {
        if (err.code !== 11000) throw err;
        delivery = await WebhookDelivery.findOne({ eventId: ev._id, endpointId: ep._id }).lean();
      }
      if (delivery.status === 'pending') {
        await enqueue('webhooks', 'deliver', { deliveryId: delivery._id }, { jobId: delivery._id, attempts: env.WEBHOOK_MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 5000 } });
      }
    }
    await OutboxEvent.updateOne({ _id: ev._id }, { $set: { published: true, publishedAt: new Date() } });
  }
  return { relayed: events.length };
}

/** Re-enqueue durable deliveries whose BullMQ work disappeared or whose worker lease expired. */
async function requeuePendingDeliveries(limit = 100) {
  const now = new Date();
  const staleLease = new Date(now.getTime() - env.WEBHOOK_TIMEOUT_MS - 30000);
  const deliveries = await WebhookDelivery.find({
    $or: [
      { status: { $in: ['pending', 'retrying'] } },
      { status: 'processing', leaseUntil: { $lt: now } },
      { status: 'processing', leaseUntil: null, updatedAt: { $lt: staleLease } },
    ],
  }).sort({ createdAt: 1 }).limit(limit).lean();
  const { getQueue } = require('../queues');
  const queue = getQueue('webhooks');
  let queued = 0;
  for (const delivery of deliveries) {
    const existing = await queue.getJob(delivery._id);
    if (existing) {
      const state = await existing.getState();
      if (['active', 'waiting', 'delayed', 'paused', 'waiting-children'].includes(state)) continue;
      await existing.remove();
    }
    await enqueue('webhooks', 'deliver', { deliveryId: delivery._id }, {
      jobId: delivery._id,
      attempts: env.WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5000 },
    });
    queued += 1;
  }
  return { queued };
}

function buildPayload(ev) {
  return JSON.stringify({
    id: ev._id,
    object: 'event',
    type: ev.type,
    created: Math.floor(new Date(ev.createdAt).getTime() / 1000),
    data: { object: ev.data },
  });
}

/** One HTTP attempt. Throws on non-2xx so BullMQ schedules the next retry. */
async function deliver(deliveryId, { attemptNumber = 1 } = {}) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + env.WEBHOOK_TIMEOUT_MS + 30000);
  const d = await WebhookDelivery.findOneAndUpdate(
    { _id: deliveryId, $or: [{ status: { $in: ['pending', 'retrying'] } }, { status: 'processing', leaseUntil: { $lt: now } }] },
    { $set: { status: 'processing', leaseUntil } },
    { new: true },
  ).lean();
  if (!d) return { skipped: true };
  const [ep, ev] = await Promise.all([WebhookEndpoint.findById(d.endpointId).lean(), OutboxEvent.findById(d.eventId).lean()]);
  if (!ep || !ep.active || !ev) {
    await WebhookDelivery.updateOne({ _id: deliveryId }, { $set: { status: 'failed', lastError: 'Endpoint removed or disabled' }, $unset: { leaseUntil: 1 } });
    return { skipped: true };
  }

  const body = buildPayload(ev);
  const started = Date.now();
  let statusCode = null;
  let error = null;
  try {
    const currentSecret = decryptWebhookSecret(ep.secret);
    const previousSecret = ep.previousSecret && ep.previousSecretExpiresAt > new Date() ? decryptWebhookSecret(ep.previousSecret) : null;
    statusCode = await postWebhook(ep.url, body, {
        'content-type': 'application/json',
        'user-agent': 'PayOps-Webhooks/1.0',
        'payops-event-id': ev._id,
        'payops-signature': signWebhook(currentSecret, body),
        ...(previousSecret ? { 'payops-signature-previous': signWebhook(previousSecret, body) } : {}),
        'onyx-event-id': ev._id,
        'onyx-signature': signWebhook(previousSecret || currentSecret, body),
    });
    if (statusCode < 200 || statusCode >= 300) error = `Endpoint responded with ${statusCode}`;
  } catch (err) {
    error = err.name === 'TimeoutError' ? `No response within ${env.WEBHOOK_TIMEOUT_MS} ms` : err.message;
  }

  const attempt = { at: new Date(), attemptNumber, statusCode, error, durationMs: Date.now() - started };
  await WebhookDelivery.updateOne(
    { _id: deliveryId },
    {
      $push: { attempts: { $each: [attempt], $slice: -20 } },
      $inc: { attemptCount: 1 },
      $set: { status: error ? 'retrying' : 'succeeded', lastError: error, lastAttemptAt: attempt.at, ...(error ? {} : { deliveredAt: attempt.at }) },
      $unset: { leaseUntil: 1 },
    },
  );
  if (error) throw new Error(error);
  return { delivered: true };
}

async function markDead(deliveryId, error) {
  await WebhookDelivery.updateOne({ _id: deliveryId, status: { $ne: 'succeeded' } }, { $set: { status: 'dead', lastError: error }, $unset: { leaseUntil: 1 } });
  logger.warn({ deliveryId, error }, 'Webhook delivery moved to dead letter after final attempt');
}

async function replay(merchantId, deliveryId) {
  const d = await WebhookDelivery.findOneAndUpdate({ _id: deliveryId, merchantId }, { $set: { status: 'pending', lastError: null } }, { new: true }).lean();
  if (!d) throw notFound('Delivery not found');
  await enqueue('webhooks', 'deliver', { deliveryId: d._id }, { jobId: newId(`${d._id}-replay`, 6), attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
  return d;
}

module.exports = { isPublicAddress, resolvePublicAddresses, assertDeliverableUrl, createEndpoint, rotateEndpointSecret, deleteEndpoint, relayOutbox, requeuePendingDeliveries, deliver, markDead, replay, buildPayload };
