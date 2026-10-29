// PayOps | Author: differentiatorX <madhur.m2006@gmail.com> | https://github.com/differentiatorX | MIT License
const env = require('../config/env');
const { forbidden } = require('../lib/errors');

/** Admin privileges are granted only to authenticated accounts explicitly allowlisted by deployment config. */
module.exports = (req, res, next) => {
  const email = req.merchant?.email?.trim().toLowerCase();
  if (!email || !env.PLATFORM_ADMIN_EMAILS.includes(email)) return next(forbidden('Platform administrator access is required'));
  return next();
};
