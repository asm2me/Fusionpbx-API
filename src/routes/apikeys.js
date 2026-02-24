/**
 * API Key Management Routes
 *
 * All routes require authentication.
 * Domain-key users can only manage keys within their own domain.
 * Admin users can manage keys across all domains.
 *
 * POST   /api/apikeys          – Create a new API key for a FusionPBX user
 * GET    /api/apikeys          – List API keys (scoped to domain or all for admin)
 * DELETE /api/apikeys/:uuid    – Revoke (hard-delete) a key
 * PATCH  /api/apikeys/:uuid    – Enable / disable a key
 */

const express = require('express');
const { body, param } = require('express-validator');
const { authenticate, requireDomain, invalidateKeyCache } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const dbService = require('../services/dbService');
const logger    = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

// ─── Create API Key ───────────────────────────────────────────────────────────

/**
 * POST /api/apikeys
 *
 * Creates a new API key linked to a FusionPBX user.
 * The plain key is returned ONCE in the response — it is never stored.
 *
 * Body:
 *  {
 *    "username":    "john.doe",         // FusionPBX username
 *    "domain":      "company.com",      // FusionPBX domain
 *    "description": "CRM Production",   // optional label
 *    "is_admin":    false,              // optional – cross-domain admin key
 *    "expires_at":  "2025-12-31T00:00:00Z" // optional
 *  }
 *
 * Response:
 *  {
 *    "plain_key": "fpx_a1b2c3...",   ← shown ONCE, save it now
 *    "key": { uuid, domain, username, key_prefix, description, ... }
 *  }
 */
router.post(
  '/',
  [
    body('username').notEmpty().withMessage('username is required'),
    body('domain').notEmpty().withMessage('domain is required'),
    body('description').optional().isString().isLength({ max: 255 }),
    body('is_admin').optional().isBoolean(),
    body('expires_at').optional().isISO8601().withMessage('expires_at must be ISO 8601'),
  ],
  validate,
  async (req, res) => {
    try {
      const { username, domain, description, is_admin = false, expires_at } = req.body;

      // Non-admin users can only create keys for their own domain
      if (!req.user.admin && req.domain !== domain) {
        return res.status(403).json({ error: 'You can only create keys for your own domain' });
      }

      // Non-admin users cannot create admin keys
      if (!req.user.admin && is_admin) {
        return res.status(403).json({ error: 'Only admin users can create admin API keys' });
      }

      // Verify the FusionPBX user exists in the specified domain
      const fpxUser = await dbService.getFusionPBXUser(username, domain);
      if (!fpxUser) {
        return res.status(404).json({
          error: `FusionPBX user "${username}" not found in domain "${domain}"`,
        });
      }

      const { plainKey, record } = await dbService.createApiKey({
        userUuid:    fpxUser.user_uuid,
        domainUuid:  fpxUser.domain_uuid,
        domainName:  fpxUser.domain_name,
        username:    fpxUser.username,
        description,
        isAdmin:     is_admin,
        expiresAt:   expires_at ? new Date(expires_at) : undefined,
      });

      logger.info('API key created', {
        uuid: record.api_key_uuid,
        domain,
        username,
        createdBy: req.user.userId,
      });

      res.status(201).json({
        plain_key: plainKey,                // ← save this now, shown once only
        key: record,
        warning: 'Save the plain_key immediately — it will not be shown again.',
      });
    } catch (err) {
      logger.error('API key creation error', { error: err.message });
      res.status(500).json({ error: 'Failed to create API key' });
    }
  }
);

// ─── List API Keys ────────────────────────────────────────────────────────────

/**
 * GET /api/apikeys?domain=company.com
 *
 * Lists API keys.
 * Domain-key users see only their domain's keys.
 * Admin users can pass ?domain= to filter, or omit it to see all.
 */
router.get('/', async (req, res) => {
  try {
    // Determine scope
    let domainFilter;
    if (req.user.admin) {
      domainFilter = req.query.domain || null;   // admin can see all or filter
    } else {
      domainFilter = req.domain;                 // non-admin locked to their domain
    }

    const keys = await dbService.listApiKeys(domainFilter);
    res.json({ keys, count: keys.length });
  } catch (err) {
    logger.error('API key list error', { error: err.message });
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// ─── Revoke API Key ───────────────────────────────────────────────────────────

/**
 * DELETE /api/apikeys/:uuid
 *
 * Permanently revokes an API key.
 * The cache entry is cleared immediately so the key stops working at once.
 */
router.delete(
  '/:uuid',
  [param('uuid').isUUID().withMessage('Invalid key UUID')],
  validate,
  async (req, res) => {
    try {
      // Non-admin: scope deletion to their domain
      const domainScope = req.user.admin ? null : req.domain;
      const deleted = await dbService.revokeApiKey(req.params.uuid, domainScope);

      if (!deleted) {
        return res.status(404).json({ error: 'API key not found or not accessible' });
      }

      // Clear cache so the key is invalidated immediately (no waiting for TTL)
      invalidateKeyCache(req.params.uuid);

      logger.info('API key revoked', {
        uuid: req.params.uuid,
        revokedBy: req.user.userId,
      });

      res.json({ success: true, message: 'API key revoked' });
    } catch (err) {
      logger.error('API key revoke error', { error: err.message });
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  }
);

// ─── Enable / Disable API Key ────────────────────────────────────────────────

/**
 * PATCH /api/apikeys/:uuid
 *
 * Enable or disable a key without deleting it.
 *
 * Body: { "enabled": false }
 */
router.patch(
  '/:uuid',
  [
    param('uuid').isUUID().withMessage('Invalid key UUID'),
    body('enabled').isBoolean().withMessage('enabled must be a boolean'),
  ],
  validate,
  async (req, res) => {
    try {
      const domainScope = req.user.admin ? null : req.domain;
      const updated = await dbService.setApiKeyEnabled(
        req.params.uuid,
        req.body.enabled,
        domainScope
      );

      if (!updated) {
        return res.status(404).json({ error: 'API key not found or not accessible' });
      }

      // Clear cache immediately on disable
      if (!req.body.enabled) {
        invalidateKeyCache(req.params.uuid);
      }

      logger.info('API key updated', {
        uuid: req.params.uuid,
        enabled: req.body.enabled,
        updatedBy: req.user.userId,
      });

      res.json({ success: true, enabled: req.body.enabled });
    } catch (err) {
      logger.error('API key update error', { error: err.message });
      res.status(500).json({ error: 'Failed to update API key' });
    }
  }
);

module.exports = router;
