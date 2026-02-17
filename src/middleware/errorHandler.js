const logger = require('../logger');

function errorHandler(err, req, res, _next) {
  const status = err.response?.status || err.status || 500;

  const message =
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.message ||
    'Internal server error';

  logger.error(`${req.method} ${req.path} -> ${status}: ${message}`);

  if (err.response?.data) {
    logger.debug('opencode error payload:', JSON.stringify(err.response.data));
  }

  // Log stack trace only for unexpected 5xx errors at debug level
  if (status >= 500 && err.stack) {
    logger.debug(err.stack);
  }

  res.status(status).json({
    success: false,
    error: message,
    code: err.code || null,
    opencode_error: err.response?.data || null,
    timestamp: new Date().toISOString(),
  });
}

module.exports = errorHandler;
