// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const pino = require('pino');
const env = require('./env');
const redact = require('./logRedactions');

module.exports = pino({
  level: env.LOG_LEVEL,
  base: { service: process.env.SERVICE_NAME || 'payops-api' },
  redact,
});
