/**
 * @swagger
 * tags:
 *   name: Domains
 *   description: FusionPBX domains (tenants)
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const dbService = require('../services/dbService');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * /api/domains:
 *   get:
 *     summary: List all FusionPBX domains
 *     tags: [Domains]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Domain list
 */
router.get('/', async (req, res, next) => {
  try {
    const domains = await dbService.getDomains();
    res.json({ domains, count: domains.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
