# @payops/node

Zero-dependency Node.js client for PayOps.

```js
const { PayOps } = require('@payops/node');
const payops = new PayOps(process.env.PAYOPS_SECRET_KEY || process.env.ONYX_SECRET_KEY, { baseUrl: 'http://localhost:4000' });

// Safe to retry: the SDK sends an Idempotency-Key and retries 409/429/5xx with backoff.
const payment = await payops.payments.create(
  { amount: 49900, description: 'Order #1042', customer: { email: 'riya@example.com' } },
  { idempotencyKey: 'order-1042' },
);
console.log(payment.checkout_url);

await payops.refunds.create(payment.id, { amount: 10000 }, { idempotencyKey: 'order-1042-refund-1' });

// In your webhook handler (Express: use express.raw for this route)
const ok = PayOps.verifyWebhook(req.body.toString(), req.get('payops-signature') || req.get('onyx-signature'), process.env.PAYOPS_WEBHOOK_SECRET || process.env.ONYX_WEBHOOK_SECRET);
```

## Author

[differentiatorX](https://github.com/differentiatorX), [madhur.m2006@gmail.com](mailto:madhur.m2006@gmail.com). MIT License.
