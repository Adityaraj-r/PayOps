// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const { connectDb, disconnectDb } = require('../src/config/db');
const env = require('../src/config/env');
const { WebhookEndpoint } = require('../src/models');
const { encryptWebhookSecret, isEncryptedWebhookSecret } = require('../src/lib/webhookSecretCrypto');

async function main() {
  await connectDb(env.MONGO_URI);
  try {
    const endpoints = await WebhookEndpoint.find({}, { _id: 1, secret: 1, secretPreview: 1 }).lean();
    const pending = endpoints.filter((endpoint) => !isEncryptedWebhookSecret(endpoint.secret));
    if (!process.argv.includes('--apply')) {
      process.stdout.write(`${pending.length} webhook endpoint secret(s) need encryption. Re-run with --apply to update them.\n`);
      return;
    }
    let encrypted = 0;
    for (const endpoint of pending) {
      const result = await WebhookEndpoint.updateOne(
        { _id: endpoint._id, secret: endpoint.secret },
        { $set: { secret: encryptWebhookSecret(endpoint.secret), secretPreview: endpoint.secretPreview || `${endpoint.secret.slice(0, 10)}…` } },
      );
      encrypted += result.modifiedCount;
    }
    process.stdout.write(`Encrypted ${encrypted} webhook endpoint secret(s).\n`);
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  process.stderr.write(`Webhook secret migration failed: ${err.message}\n`);
  process.exitCode = 1;
});
