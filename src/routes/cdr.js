/**
 * @swagger
 * tags:
 *   name: CDR
 *   description: Call Detail Records - historical call activity
 */

const express = require('express');
const { query, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const dbService = require('../services/dbService');

const router = express.Router();

router.use(authenticate);

/**
 * @swagger
 * /api/cdr:
 *   get:
 *     summary: Get call detail records with filters
 *     tags: [CDR]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         schema:
 *           type: string
 *         description: FusionPBX domain (required for tenant isolation)
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date/time filter (ISO 8601)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date/time filter (ISO 8601)
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [inbound, outbound, local]
 *         description: Call direction filter
 *       - in: query
 *         name: extension
 *         schema:
 *           type: string
 *         description: Filter by extension (caller or callee)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search caller/callee number or name
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: CDR records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 records:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CDRRecord'
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 */
router.get(
  '/',
  [
    query('limit').optional().isInt({ min: 1, max: 1000 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const {
        domain,
        start_date: startDate,
        end_date: endDate,
        direction,
        extension,
        search: searchNumber,
        limit = 100,
        offset = 0,
      } = req.query;

      const filters = { domain, startDate, endDate, direction, extension, searchNumber, limit, offset };
      const [records, total] = await Promise.all([
        dbService.getCDR(filters),
        dbService.countCDR(filters),
      ]);

      res.json({ records, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/cdr/{uuid}:
 *   get:
 *     summary: Get a single CDR record by UUID
 *     tags: [CDR]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: CDR record
 *       404:
 *         description: Not found
 */
router.get(
  '/:uuid',
  [param('uuid').notEmpty().isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const record = await dbService.getCDRByUUID(req.params.uuid);
      if (!record) return res.status(404).json({ error: 'CDR record not found' });
      res.json({ record });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/cdr/stats/summary:
 *   get:
 *     summary: Get call statistics summary (totals, answered, missed, avg duration)
 *     tags: [CDR]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         schema:
 *           type: string
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Call statistics
 */
router.get('/stats/summary', async (req, res, next) => {
  try {
    const { domain, start_date: startDate, end_date: endDate } = req.query;
    const stats = await dbService.getCallStats({ domain, startDate, endDate });
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
