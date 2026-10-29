const models = require('../src/models');

jest.mock('../src/models', () => ({ WebhookEndpoint: { findOne: jest.fn(), findOneAndUpdate: jest.fn() } }));

const webhooks = require('../src/services/webhookService');
const { decryptWebhookSecret, isEncryptedWebhookSecret } = require('../src/lib/webhookSecretCrypto');

describe('webhook secret rotation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('stores encrypted current and previous secrets and returns the new secret once', async () => {
    const endpoint = { _id: 'we_1', merchantId: 'mer_1', secret: 'enc:v1:old-ciphertext', previousSecretExpiresAt: null };
    const stored = { ...endpoint, secret: 'enc:v1:new-ciphertext' };
    models.WebhookEndpoint.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(endpoint) });
    models.WebhookEndpoint.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(stored) });

    const result = await webhooks.rotateEndpointSecret('mer_1', 'we_1');

    expect(models.WebhookEndpoint.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: 'we_1', merchantId: 'mer_1', secret: endpoint.secret });
    const update = models.WebhookEndpoint.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update.previousSecret).toBe(endpoint.secret);
    expect(update.previousSecretExpiresAt.getTime() - update.secretRotatedAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(isEncryptedWebhookSecret(update.secret)).toBe(true);
    expect(result.secret).toMatch(/^whsec_/);
    expect(decryptWebhookSecret(update.secret)).toBe(result.secret);
  });

  test('does not allow another rotation while the overlap period is active', async () => {
    models.WebhookEndpoint.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: 'we_1', merchantId: 'mer_1', secret: 'enc:v1:old', previousSecretExpiresAt: new Date(Date.now() + 10000),
    }) });

    await expect(webhooks.rotateEndpointSecret('mer_1', 'we_1')).rejects.toMatchObject({ code: 'webhook_secret_rotation_in_progress' });
    expect(models.WebhookEndpoint.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
