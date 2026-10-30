module.exports = (req) => ({
  id: req.id,
  method: req.method,
  // Do not put query values in logs; legacy checkout URLs may carry capabilities.
  url: String(req.url || '').split('?')[0],
  headers: req.headers,
});
