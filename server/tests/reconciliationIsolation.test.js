process.env.PLATFORM_ADMIN_EMAILS = 'operator@payops.test';

const jwt = require('jsonwebtoken');
const { ReconciliationReport, Merchant } = require('../src/models');
const env = require('../src/config/env');
const reconciliation = require('../src/services/reconciliationService');
const { createApp } = require('../src/app');

describe('merchant reconciliation isolation', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns only the requesting merchant issues, counts, and ledger check', async () => {
    const report = {
      _id: 'rec_test',
      createdAt: new Date('2026-10-30T00:00:00Z'),
      trigger: 'schedule',
      counts: { matched: 17, amountMismatch: 6, statusMismatch: 2, missingAtProvider: 1, missingInOnyx: 5 },
      merchantCounts: [
        { merchantId: 'mer_a', matched: 7, amountMismatch: 2, statusMismatch: 1, missingAtProvider: 0 },
        { merchantId: 'mer_b', matched: 10, amountMismatch: 4, statusMismatch: 1, missingAtProvider: 1 },
      ],
      amountMismatch: [
        { merchantId: 'mer_a', paymentId: 'pay_a', ourAmount: 100, providerAmount: 90 },
        { merchantId: 'mer_b', paymentId: 'pay_b', ourAmount: 200, providerAmount: 190 },
      ],
      statusMismatch: [{ merchantId: 'mer_b', paymentId: 'pay_b2' }],
      missingAtProvider: [{ merchantId: 'mer_a', paymentId: 'pay_a2' }, { merchantId: 'mer_b', paymentId: 'pay_b3' }],
      missingInOnyx: [{ providerPaymentId: 'provider_only' }],
      ledgerChecks: [
        { merchantId: 'mer_a', balanced: true, totalDebits: 100, totalCredits: 100, driftAccounts: [] },
        { merchantId: 'mer_b', balanced: false, totalDebits: 999, totalCredits: 998, driftAccounts: ['merchant_payable'] },
      ],
    };
    const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([report]) };
    jest.spyOn(ReconciliationReport, 'find').mockReturnValue(query);

    const [result] = await reconciliation.latestForMerchant('mer_a');

    expect(result.matched_count).toBe(7);
    expect(result.issue_counts).toEqual({ amount_mismatch: 2, status_mismatch: 1, missing_at_provider: 0 });
    expect(result.issue_count).toBe(3);
    expect(result.issues.amount_mismatch).toEqual([expect.objectContaining({ paymentId: 'pay_a' })]);
    expect(result.issues.status_mismatch).toEqual([]);
    expect(result.ledger).toEqual(expect.objectContaining({ merchantId: 'mer_a', totalDebits: 100 }));
    expect(result).not.toHaveProperty('platform_counts');
    expect(JSON.stringify(result)).not.toContain('mer_b');
    expect(JSON.stringify(result)).not.toContain('provider_only');
  });

  test('ordinary authenticated merchants cannot trigger global reconciliation', async () => {
    const merchant = { _id: 'mer_customer', email: 'customer@example.test' };
    jest.spyOn(Merchant, 'findById').mockReturnValue({ lean: jest.fn().mockResolvedValue(merchant) });
    const run = jest.spyOn(reconciliation, 'run').mockResolvedValue({});
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const token = jwt.sign({ sub: merchant._id }, env.JWT_SECRET);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/reconciliation/run`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('forbidden');
      expect(run).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
