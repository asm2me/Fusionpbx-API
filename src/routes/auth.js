/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication - obtain JWT tokens
 */

const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { generateToken } = require('../middleware/auth');
const config = require('../config/config');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /api/auth/token:
 *   post:
 *     summary: Exchange API key for a JWT token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [api_key]
 *             properties:
 *               api_key:
 *                 type: string
 *                 description: Your CRM API key
 *               domain:
 *                 type: string
 *                 description: FusionPBX domain scope
 *     responses:
 *       200:
 *         description: JWT token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expires_in:
 *                   type: string
 *       401:
 *         description: Invalid API key
 */
router.post(
  '/token',
  [
    body('api_key').notEmpty().withMessage('api_key is required'),
  ],
  validate,
  (req, res) => {
    const { api_key, domain } = req.body;

    if (api_key !== config.auth.apiKey) {
      logger.warn('Token request with invalid API key', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const token = generateToken({
      userId: 'crm-service',
      domain: domain || null,
      scope: 'full',
    });

    logger.info('JWT token issued', { domain, ip: req.ip });

    res.json({
      token,
      expires_in: config.auth.jwtExpiresIn,
      token_type: 'Bearer',
    });
  }
);

/**
 * @swagger
 * /api/auth/verify:
 *   get:
 *     summary: Verify current authentication credentials
 *     tags: [Auth]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Auth is valid
 *       401:
 *         description: Unauthorized
 */
router.get('/verify', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
