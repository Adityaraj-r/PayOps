// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const crypto = require('node:crypto');
const env = require('../config/env');

const PREFIX = 'enc:v1:';
const key = () => crypto.createHash('sha256').update(env.WEBHOOK_SECRET_ENCRYPTION_KEY, 'utf8').digest();

function encryptWebhookSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptWebhookSecret(value) {
  if (!value?.startsWith(PREFIX)) return value; // one-time migration compatibility for existing plaintext records
  const [ivText, tagText, ciphertextText] = value.slice(PREFIX.length).split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Stored webhook secret ciphertext is malformed');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

module.exports = { encryptWebhookSecret, decryptWebhookSecret, isEncryptedWebhookSecret: (value) => value?.startsWith(PREFIX) };
