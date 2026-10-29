const { encryptWebhookSecret, decryptWebhookSecret, isEncryptedWebhookSecret } = require('../src/lib/webhookSecretCrypto');

describe('webhook secret encryption at rest', () => {
  test('encrypts secrets and decrypts them for signing', () => {
    const plain = 'whsec_a-test-secret-that-must-not-be-stored-plaintext';
    const encrypted = encryptWebhookSecret(plain);
    expect(encrypted).not.toContain(plain);
    expect(isEncryptedWebhookSecret(encrypted)).toBe(true);
    expect(decryptWebhookSecret(encrypted)).toBe(plain);
  });

  test('continues to read legacy plaintext secrets during migration', () => {
    expect(decryptWebhookSecret('whsec_legacy-secret')).toBe('whsec_legacy-secret');
    expect(isEncryptedWebhookSecret('whsec_legacy-secret')).toBe(false);
  });

  test('rejects tampered ciphertext', () => {
    const encrypted = encryptWebhookSecret('whsec_tamper-test');
    const parts = encrypted.split('.');
    const tag = parts[1];
    parts[1] = `${tag[0] === 'a' ? 'b' : 'a'}${tag.slice(1)}`;
    const tampered = parts.join('.');
    expect(() => decryptWebhookSecret(tampered)).toThrow();
  });
});
