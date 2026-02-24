const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, generateToken, getConfiguredDomains } = require('../middleware/auth');
const config = require('../config/config');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/auth/token
 *
 * Exchange a domain API key for a short-lived JWT.
 * The domain is inferred automatically from the key — no need to pass it.
 *
 * Body:
 *   { "api_key": "your-domain-api-key" }
 *
 * Response:
 *   { token, expires_in, token_type, domain }
 *
 * Admin key behaviour:
 *   Pass { "api_key": "<admin-key>", "domain": "target.com" } to obtain a
 *   JWT scoped to any specific domain.
 */
router.post(
  '/token',
  [body('api_key').notEmpty().withMessage('api_key is required')],
  validate,
  (req, res) => {
    const { api_key, domain: bodyDomain } = req.body;

    // ── Admin key ─────────────────────────────────────────────────────────────
    if (config.auth.adminApiKey && api_key === config.auth.adminApiKey) {
      if (bodyDomain && !config.auth.domainToKey[bodyDomain]) {
        return res.status(400).json({ error: `Domain "${bodyDomain}" is not configured` });
      }
      const token = generateToken({
        userId: 'admin',
        domain: bodyDomain || null,
        admin: true,
        scope: 'full',
      });
      logger.info('Admin JWT issued', { domain: bodyDomain || 'all', ip: req.ip });
      return res.json({ token, expires_in: config.auth.jwtExpiresIn, token_type: 'Bearer', domain: bodyDomain || null });
    }

    // ── Domain API key ────────────────────────────────────────────────────────
    const domain = config.auth.keyToDomain[api_key];
    if (!domain) {
      logger.warn('Token request with invalid API key', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const token = generateToken({
      userId: 'crm-service',
      domain,
      scope: 'full',
    });

    logger.info('JWT issued', { domain, ip: req.ip });
    res.json({ token, expires_in: config.auth.jwtExpiresIn, token_type: 'Bearer', domain });
  }
);

/**
 * GET /api/auth/verify
 * Verify current credentials and return user/domain context.
 */
router.get('/verify', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user, domain: req.domain });
});

/**
 * GET /api/auth/domains
 * Admin only – list all configured domains (keys are redacted).
 */
router.get('/domains', authenticate, (req, res) => {
  if (!req.user?.admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  res.json({ domains: getConfiguredDomains() });
});

module.exports = router;
