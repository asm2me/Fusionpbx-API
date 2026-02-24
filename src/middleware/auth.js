/**
 * Authentication Middleware
 *
 * Three auth paths:
 *
 *  1. Domain API Key  (X-API-Key header or ?api_key= query)
 *     – Each CRM tenant has its own key mapped to exactly one domain.
 *     – On success: req.domain is automatically set to that domain.
 *     – The caller CANNOT access any other domain.
 *
 *  2. Admin API Key   (same X-API-Key header, ADMIN_API_KEY value)
 *     – Cross-domain access; domain must be supplied via ?domain= or body.domain.
 *     – req.user.admin = true
 *
 *  3. JWT Bearer      (Authorization: Bearer <token>)
 *     – Issued by POST /api/auth/token; always carries the domain in its payload.
 *     – On success: req.domain is set from the token's domain claim.
 */

const jwt    = require('jsonwebtoken');
const config = require('../config/config');
const logger = require('../utils/logger');

function _resolveRequestDomain(req) {
  return req.query.domain || req.body?.domain || req.params?.domain || null;
}

/**
 * Main auth middleware.
 * Sets req.user and req.domain on success.
 */
function authenticate(req, res, next) {
  // ── 1. API Key ──────────────────────────────────────────────────────────────
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (apiKey) {
    // Admin key – cross-domain access
    if (config.auth.adminApiKey && apiKey === config.auth.adminApiKey) {
      req.user   = { type: 'api_key', userId: 'admin', admin: true };
      req.domain = _resolveRequestDomain(req);   // admin must supply domain explicitly
      return next();
    }

    // Per-domain key lookup
    const domain = config.auth.keyToDomain[apiKey];
    if (domain) {
      req.user   = { type: 'api_key', userId: 'crm-service', domain };
      req.domain = domain;   // locked – cannot be overridden by query params
      return next();
    }

    logger.warn('API key rejected', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // ── 2. JWT Bearer ───────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      req.user   = { type: 'jwt', ...decoded };
      req.domain = decoded.domain || _resolveRequestDomain(req);
      return next();
    } catch (err) {
      logger.warn('JWT verification failed', { error: err.message });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({
    error: 'Authentication required',
    hint:  'Provide X-API-Key header or Authorization: Bearer <token>',
  });
}

/**
 * Generate a domain-scoped JWT token.
 */
function generateToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

/**
 * Middleware: ensures req.domain is resolved after authenticate().
 * Admin users must supply ?domain= explicitly.
 */
function requireDomain(req, res, next) {
  if (!req.domain) {
    return res.status(400).json({
      error: 'Domain context is required',
      hint:  req.user?.admin
        ? 'Admin key: pass ?domain=<domain> or include domain in the request body'
        : 'Your API key is not associated with any domain – check DOMAIN_API_KEYS config',
    });
  }
  next();
}

/**
 * List all configured domains (key is redacted).
 * Intended for admin status endpoints.
 */
function getConfiguredDomains() {
  return Object.entries(config.auth.domainToKey).map(([domain, key]) => ({
    domain,
    keyPrefix: key.slice(0, 4) + '****',
  }));
}

module.exports = { authenticate, generateToken, requireDomain, getConfiguredDomains };
