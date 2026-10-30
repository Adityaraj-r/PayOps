const fs = require('node:fs');
const path = require('node:path');

test('Docker dashboard proxies dashboard and merchant API paths to the API service', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '..', '..', 'client', 'nginx.conf'), 'utf8');
  for (const route of ['/api/', '/v1/']) {
    const block = config.match(new RegExp(`location ${route.replace('/', '\\/')} \\{([\\s\\S]*?)\\n  \\}`));
    expect(block).not.toBeNull();
    expect(block[1]).toContain('proxy_pass http://api:4000;');
    expect(block[1]).toContain('proxy_set_header Host $host;');
    expect(block[1]).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
  }
  expect(config.indexOf('location /v1/')).toBeLessThan(config.indexOf('location / {'));
  expect(config).toContain('$request_method $uri $server_protocol');
  expect(config).not.toContain('"$request"');
  expect(config).not.toContain('$http_referer');
});
