const logger = require('../utils/logger');

/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error('Unhandled error', {
    status,
    message,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * 404 handler for undefined routes.
 */
function notFound(req, res) {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = { errorHandler, notFound };
