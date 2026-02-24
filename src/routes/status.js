/**
 * @swagger
 * tags:
 *   name: Status
 *   description: API health and system status
 */

const express = require('express');
const eslService = require('../services/eslService');
const dbService = require('../services/dbService');
const wsService = require('../services/wsService');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/status:
 *   get:
 *     summary: API health check (no auth required)
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: API is running
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FusionPBX API Bridge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /api/status/detailed:
 *   get:
 *     summary: Detailed system status (requires auth)
 *     tags: [Status]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: System status details
 */
router.get('/detailed', authenticate, async (req, res, next) => {
  try {
    const [dbOk] = await Promise.all([dbService.testConnection()]);
    const eslStatus = eslService.getStatus();
    const wsClients = wsService.getConnectedClients();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        esl: { ...eslStatus },
        database: { connected: dbOk },
        websocket: { connectedClients: wsClients.length, clients: wsClients },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
