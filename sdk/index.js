// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
/**
 * PayOps Node SDK. Zero dependencies.
 *
 *   const PayOps = require('@payops/node');
 *   const payops = new PayOps(process.env.PAYOPS_SECRET_KEY || process.env.ONYX_SECRET_KEY);
 *   const payment = await payops.payments.create({ amount: 49900, customer: { email } }, { idempotencyKey: orderId });
 */
const crypto = require('crypto');

class PayOpsError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'PayOpsError';
    this.status = status;
    this.code = code;
  }
}

const RETRYABLE = new Set([409, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PayOps {
  constructor(secretKey, { baseUrl = 'http://localhost:4000', maxRetries = 3, timeoutMs = 15000 } = {}) {
    if (!secretKey || !secretKey.startsWith('sk_')) throw new Error('PayOps: pass your secret key (sk_test_...)');
    this.secretKey = secretKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;

    this.payments = {
      create: (params, opts) => this.request('POST', '/v1/payments', params, opts),
      retrieve: (id) => this.request('GET', `/v1/payments/${encodeURIComponent(id)}`),
      list: (query = {}) => this.request('GET', `/v1/payments?${new URLSearchParams(query)}`),
    };
    this.refunds = {
      create: (paymentId, params = {}, opts) => this.request('POST', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, params, opts),
      retrieve: (id) => this.request('GET', `/v1/refunds/${encodeURIComponent(id)}`),
    };
    this.balance = { retrieve: () => this.request('GET', '/v1/balance') };
  }

  /**
   * POSTs always carry an Idempotency-Key (generated if you do not pass one), so the
   * automatic retries below can never create a second payment or refund.
   */
  async request(method, path, body, { idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json', 'user-agent': 'payops-node/0.1.0 (github.com/Adityaraj-r/PayOps)' };
    if (method === 'POST') headers['idempotency-key'] = idempotencyKey || crypto.randomUUID();

    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await sleep(2 ** attempt * 300);
          continue;
        }
        throw new PayOpsError(`Network error: ${err.message}`, 0, 'network_error');
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter ? retryAfter * 1000 : 2 ** attempt * 300);
        continue;
      }
      throw new PayOpsError(json?.error?.message || `HTTP ${res.status}`, res.status, json?.error?.code);
    }
  }

  /** Verify a webhook. Pass the raw body string exactly as received. */
  static verifyWebhook(rawBody, signatureHeader, secret, toleranceSec = 300) {
    if (!signatureHeader) return false;
    const parts = Object.fromEntries(String(signatureHeader).split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || !parts.v1 || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = PayOps;
module.exports.PayOps = PayOps;
module.exports.PayOpsError = PayOpsError;
// Keep aliases for existing consumers of the original SDK export names.
module.exports.Onyx = PayOps;
module.exports.OnyxError = PayOpsError;
