/**
 * @swagger
 * tags:
 *   name: Extensions
 *   description: FusionPBX extensions and registrations
 */

const express = require('express');
const { query, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const dbService = require('../services/dbService');
const fusionpbxService = require('../services/fusionpbxService');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * /api/extensions:
 *   get:
 *     summary: Get all extensions for a domain
 *     tags: [Extensions]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of extensions
 */
router.get(
  '/',
  [query('domain').notEmpty().withMessage('domain is required')],
  validate,
  async (req, res, next) => {
    try {
      const extensions = await dbService.getExtensions(req.query.domain);
      res.json({ extensions, count: extensions.length });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/extensions/{extension}:
 *   get:
 *     summary: Get a specific extension by number
 *     tags: [Extensions]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: extension
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Extension details
 *       404:
 *         description: Extension not found
 */
router.get(
  '/:extension',
  [
    param('extension').notEmpty(),
    query('domain').notEmpty().withMessage('domain is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const ext = await dbService.getExtensionByNumber(req.params.extension, req.query.domain);
      if (!ext) return res.status(404).json({ error: 'Extension not found' });
      res.json({ extension: ext });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/extensions/registrations:
 *   get:
 *     summary: Get registered SIP endpoints (online/offline status)
 *     tags: [Extensions]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Registration list
 */
router.get('/registrations', async (req, res, next) => {
  try {
    const regs = await fusionpbxService.getRegistrations(req.query.domain);
    res.json({ registrations: regs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
