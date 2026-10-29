// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const { Schema, model } = require('mongoose');
const { newId } = require('../lib/ids');

const OperatorActionSchema = new Schema({
  operatorId: { type: String, required: true },
  operatorEmail: { type: String, required: true },
  at: { type: Date, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  action: { type: String, enum: ['status_checked', 'retry', 'mark_succeeded', 'mark_failed'], required: true },
  previousState: { type: String, required: true },
  resultingState: { type: String, required: true },
  providerStatus: String,
}, { _id: false });

const ResolutionCheckSchema = new Schema({
  status: { type: String, enum: ['succeeded', 'failed', 'pending', 'not_found', 'unknown'], required: true },
  provider: { type: String, required: true },
  providerPaymentId: { type: String, required: true },
  providerRefundId: String,
  checkedAt: { type: Date, required: true },
}, { _id: false });

const RefundSchema = new Schema(
  {
    _id: { type: String, default: () => newId('rfnd') },
    paymentId: { type: String, required: true, index: true },
    merchantId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, maxlength: 255 },
    idempotencyKeyHash: { type: String, default: undefined },
    status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
    providerRefundId: String,
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    failureReason: String,
    succeededAt: Date,
    needsAttention: { type: Boolean, default: false },
    resolutionCheck: ResolutionCheckSchema,
    operatorActions: { type: [OperatorActionSchema], default: [] },
    dispatchVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

RefundSchema.index({ status: 1, createdAt: 1 });
RefundSchema.index({ status: 1, needsAttention: 1, createdAt: 1, lastAttemptAt: 1 });
RefundSchema.index({ merchantId: 1, idempotencyKeyHash: 1 }, { unique: true, partialFilterExpression: { idempotencyKeyHash: { $type: 'string' } } });

module.exports = model('Refund', RefundSchema);
