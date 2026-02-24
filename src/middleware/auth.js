/**
 * Authentication Middleware
 * Supports two methods:
 *  1. API Key:  X-API-Key header or ?api_key= query param
 *  2. JWT:      Authorization: Bearer <token> header
 */

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Validate API key or JWT token.
 * Attaches `req.user` on success.
 */
function authenticate(req, res, next) {
  // 1. Try API key
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    if (apiKey === config.auth.apiKey) {
      req.user = { type: 'api_key', userId: 'crm-service' };
      return next();
    }
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // 2. Try JWT Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      req.user = { type: 'jwt', ...decoded };
      return next();
    } catch (err) {
      logger.warn('JWT verification failed', { error: err.message });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({
    error: 'Authentication required',
    hint: 'Provide X-API-Key header or Authorization: Bearer <token>',
  });
}

/**
 * Generate a JWT token.
 */
function generateToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

/**
 * Optional middleware: only allow requests scoped to a specific domain.
 * CRM must pass ?domain= or body.domain matching a verified domain.
 */
function requireDomain(req, res, next) {
  const domain = req.query.domain || req.body?.domain || req.params?.domain;
  if (!domain) {
    return res.status(400).json({ error: 'domain parameter is required' });
  }
  req.domain = domain;
  next();
}

module.exports = { authenticate, generateToken, requireDomain };
