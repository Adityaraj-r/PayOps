// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const { Schema, model } = require('mongoose');
const { newId } = require('../lib/ids');
const { validateLines } = require('../domain/ledger');

const LineSchema = new Schema(
  {
    account: { type: String, required: true },
    direction: { type: String, enum: ['debit', 'credit'], required: true },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

/** Append-only. Corrections are new entries, never edits. */
const JournalEntrySchema = new Schema(
  {
    _id: { type: String, default: () => newId('je') },
    merchantId: { type: String, required: true, index: true },
    type: { type: String, enum: ['capture', 'refund', 'provider_settlement', 'payout'], required: true },
    ref: { type: String, required: true, index: true },
    paymentId: { type: String, index: true },
    // Exactly-once posting: "capture:pay_x", "refund:rfnd_y", ...
    idempotencyKey: { type: String, required: true, unique: true },
    lines: { type: [LineSchema], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

JournalEntrySchema.pre('validate', function checkBalanced(next) {
  try {
    validateLines(this.lines.map((l) => ({ account: l.account, direction: l.direction, amount: l.amount })));
    next();
  } catch (err) {
    next(err);
  }
});

// Journal entries are immutable after insertion. Corrections are new, balanced
// reversal/adjustment entries. Query middleware also blocks update/delete paths
// so ordinary Mongoose callers cannot bypass the append-only service contract.
JournalEntrySchema.pre('save', function preventSavedEntryMutation(next) {
  if (!this.isNew) return next(new Error('Posted journal entries are immutable'));
  next();
});

const IMMUTABLE_QUERY_OPERATIONS = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove',
];
for (const operation of IMMUTABLE_QUERY_OPERATIONS) {
  JournalEntrySchema.pre(operation, function preventJournalMutation() {
    throw new Error('Posted journal entries are immutable; post a reversal or adjustment instead');
  });
}

JournalEntrySchema.pre('deleteOne', { document: true, query: false }, function preventDocumentDelete() {
  throw new Error('Posted journal entries are immutable; post a reversal or adjustment instead');
});

// Model.bulkWrite bypasses ordinary query middleware. Permit inserts only.
JournalEntrySchema.pre('bulkWrite', function preventBulkMutation(next, operations) {
  if (operations.every((operation) => operation.insertOne)) return next();
  next(new Error('Journal entry bulk writes may only insert new entries'));
});

JournalEntrySchema.index({ merchantId: 1, createdAt: -1 });

module.exports = model('JournalEntry', JournalEntrySchema);
