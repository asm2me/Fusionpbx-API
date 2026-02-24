const express = require('express');
const { body } = require('express-validator');
const { validate }       = require('../middleware/validate');
const { authenticate, generateToken } = require('../middleware/auth');
const dbService          = require('../services/dbService');
const config             = require('../config/config');
const logger             = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/auth/token
 *
 * Exchange an API key (DB-backed or bootstrap admin) for a short-lived JWT.
 *
 * Domain-key:
 *   { "api_key": "fpx_abc123..." }
 *   → domain is resolved automatically from the DB record
 *
 * Bootstrap admin key:
 *   { "api_key": "<ADMIN_API_KEY>", "domain": "company.com" }
 *   → issues a JWT scoped to the specified domain
 */
router.post(
  '/token',
  [body('api_key').notEmpty().withMessage('api_key is required')],
  validate,
  async (req, res) => {
    try {
      const { api_key, domain: bodyDomain } = req.body;

      // ── Bootstrap admin key ────────────────────────────────────────────────
      if (config.auth.adminApiKey && api_key === config.auth.adminApiKey) {
        const token = generateToken({
          userId: 'admin',
          domain: bodyDomain || null,
          admin:  true,
          scope:  'full',
        });
        logger.info('Admin JWT issued', { domain: bodyDomain || 'all', ip: req.ip });
        return res.json({
          token,
          expires_in: config.auth.jwtExpiresIn,
          token_type: 'Bearer',
          domain:     bodyDomain || null,
        });
      }

      // ── DB-backed domain key ───────────────────────────────────────────────
      const keyData = await dbService.lookupApiKey(api_key);
      if (!keyData) {
        logger.warn('Token request with invalid API key', { ip: req.ip });
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const token = generateToken({
        userId:  keyData.username,
        userUuid: keyData.user_uuid,
        domain:  keyData.domain_name,
        admin:   keyData.is_admin,
        scope:   'full',
      });

      logger.info('JWT issued', { domain: keyData.domain_name, user: keyData.username, ip: req.ip });
      res.json({
        token,
        expires_in: config.auth.jwtExpiresIn,
        token_type: 'Bearer',
        domain:     keyData.domain_name,
        username:   keyData.username,
      });
    } catch (err) {
      logger.error('Token generation error', { error: err.message });
      res.status(500).json({ error: 'Token generation failed' });
    }
  }
);

/**
 * GET /api/auth/verify
 * Verify credentials and return the resolved user + domain context.
 */
router.get('/verify', authenticate, (req, res) => {
  res.json({ valid: true, user: req.user, domain: req.domain });
});

module.exports = router;
