const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { AppError } = require('../src/lib/errors');
const { isPublicAddress, resolvePublicAddresses, assertDeliverableUrl } = require('../src/services/webhookService');

describe('outbound webhook destination security', () => {
  test.each([
    ['127.0.0.1', 4],
    ['10.2.3.4', 4],
    ['169.254.169.254', 4],
    ['::1', 6],
    ['fc00::1', 6],
    ['fe80::1', 6],
    ['::ffff:127.0.0.1', 6],
  ])('blocks non-public address %s', (address, family) => {
    expect(isPublicAddress(address, family)).toBe(false);
  });

  test.each([
    ['8.8.8.8', 4],
    ['2606:4700:4700::1111', 6],
  ])('allows public address %s', (address, family) => {
    expect(isPublicAddress(address, family)).toBe(true);
  });

  test('rejects a hostname if any DNS answer is private', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ];

    await expect(resolvePublicAddresses('attacker.example', lookup)).rejects.toMatchObject({
      status: 400,
      message: 'Webhook URL cannot resolve to a private or reserved address',
    });
  });

  test('production refuses development routes and the known mock-bank secret', () => {
    const configPath = path.join(__dirname, '..', 'src', 'config', 'env');
    let output = '';
    try {
      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          JWT_SECRET: 'a'.repeat(48),
          ENABLE_DEV_ROUTES: 'true',
          PAYMENT_PROVIDER: 'mockbank',
          MOCKBANK_WEBHOOK_SECRET: 'mockbank_dev_secret',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      output = `${err.stdout.toString()}${err.stderr.toString()}`;
    }

    expect(output).toContain('ENABLE_DEV_ROUTES');
    expect(output).toContain('MOCKBANK_WEBHOOK_SECRET');
  });

  test('private DNS failures are reported as a client-safe application error', async () => {
    const lookup = async () => [{ address: '192.168.1.8', family: 4 }];
    await expect(resolvePublicAddresses('internal.example', lookup)).rejects.toBeInstanceOf(AppError);
  });

  test('rejects webhook URLs containing embedded credentials', async () => {
    await expect(assertDeliverableUrl('https://user:password@example.com/hook')).rejects.toMatchObject({ status: 400 });
  });
});
