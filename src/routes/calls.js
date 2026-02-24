/**
 * @swagger
 * tags:
 *   name: Calls
 *   description: Real-time call control operations (originate, hold, transfer, hangup)
 */

const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const eslService = require('../services/eslService');
const logger = require('../utils/logger');

const router = express.Router();

// All call routes require authentication
router.use(authenticate);

// ─── Active Calls ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/active:
 *   get:
 *     summary: Get all active calls (bridged channels)
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         schema:
 *           type: string
 *         description: Filter by FusionPBX domain
 *     responses:
 *       200:
 *         description: List of active calls
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 calls:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ActiveCall'
 *                 count:
 *                   type: integer
 */
router.get('/active', async (req, res, next) => {
  try {
    const { domain } = req.query;
    const calls = await eslService.getActiveCalls(domain);
    res.json({ calls, count: calls.length });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/calls/channels:
 *   get:
 *     summary: Get all active channels (individual legs)
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: domain
 *         schema:
 *           type: string
 *         description: Filter by FusionPBX domain
 *     responses:
 *       200:
 *         description: List of active channels
 */
router.get('/channels', async (req, res, next) => {
  try {
    const { domain } = req.query;
    const channels = await eslService.getActiveChannels(domain);
    res.json({ channels, count: channels.length });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/calls/channels/{uuid}:
 *   get:
 *     summary: Get info about a specific channel by UUID
 *     tags: [Calls]
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
 *         description: Channel info
 *       404:
 *         description: Channel not found
 */
router.get('/channels/:uuid', async (req, res, next) => {
  try {
    const channel = await eslService.getChannelInfo(req.params.uuid);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    res.json({ channel });
  } catch (err) {
    next(err);
  }
});

// ─── Originate Call ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/originate:
 *   post:
 *     summary: Originate (make) a new call
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OriginateRequest'
 *     responses:
 *       200:
 *         description: Call originated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uuid:
 *                   type: string
 *                   description: Call channel UUID
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       503:
 *         description: ESL not connected
 */
router.post(
  '/originate',
  [
    body('from').notEmpty().withMessage('from (extension) is required'),
    body('to').notEmpty().withMessage('to (destination) is required'),
    body('domain').notEmpty().withMessage('domain is required'),
    body('timeout').optional().isInt({ min: 5, max: 120 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { from, to, domain, callerId, callerName, timeout } = req.body;

      if (!eslService.connected) {
        return res.status(503).json({ error: 'ESL not connected to FreeSWITCH' });
      }

      logger.info('Originate call request', { from, to, domain, user: req.user });
      const result = await eslService.originateCall({ from, to, domain, callerId, callerName, timeout });

      res.json({
        uuid: result.uuid,
        message: `Call from ${from} to ${to} initiated`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Hangup ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/{uuid}/hangup:
 *   post:
 *     summary: Hangup a call by channel UUID
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: Channel UUID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cause:
 *                 type: string
 *                 description: Hangup cause (e.g. NORMAL_CLEARING, USER_BUSY)
 *                 default: NORMAL_CLEARING
 *     responses:
 *       200:
 *         description: Call hung up
 *       503:
 *         description: ESL not connected
 */
router.post(
  '/:uuid/hangup',
  [param('uuid').notEmpty().isUUID()],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) {
        return res.status(503).json({ error: 'ESL not connected' });
      }
      const { cause } = req.body;
      await eslService.hangup(req.params.uuid, cause);
      logger.info('Hangup executed', { uuid: req.params.uuid, cause });
      res.json({ success: true, message: 'Call terminated', uuid: req.params.uuid });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Hold / Unhold ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/{uuid}/hold:
 *   post:
 *     summary: Place a call on hold
 *     tags: [Calls]
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
 *         description: Call placed on hold
 */
router.post(
  '/:uuid/hold',
  [param('uuid').notEmpty().isUUID()],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
      await eslService.hold(req.params.uuid);
      logger.info('Hold executed', { uuid: req.params.uuid });
      res.json({ success: true, message: 'Call placed on hold', uuid: req.params.uuid });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/calls/{uuid}/unhold:
 *   post:
 *     summary: Remove a call from hold
 *     tags: [Calls]
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
 *         description: Call taken off hold
 */
router.post(
  '/:uuid/unhold',
  [param('uuid').notEmpty().isUUID()],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
      await eslService.unhold(req.params.uuid);
      logger.info('Unhold executed', { uuid: req.params.uuid });
      res.json({ success: true, message: 'Call resumed from hold', uuid: req.params.uuid });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/calls/{uuid}/hold/toggle:
 *   post:
 *     summary: Toggle hold state of a call
 *     tags: [Calls]
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
 *         description: Hold toggled
 */
router.post(
  '/:uuid/hold/toggle',
  [param('uuid').notEmpty().isUUID()],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
      await eslService.toggleHold(req.params.uuid);
      res.json({ success: true, message: 'Hold toggled', uuid: req.params.uuid });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Transfer ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/{uuid}/transfer:
 *   post:
 *     summary: Transfer a call (blind or attended)
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *         description: Channel UUID to transfer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransferRequest'
 *     responses:
 *       200:
 *         description: Transfer initiated
 *       400:
 *         description: Validation error
 */
router.post(
  '/:uuid/transfer',
  [
    param('uuid').notEmpty().isUUID(),
    body('destination').notEmpty().withMessage('destination is required'),
    body('domain').notEmpty().withMessage('domain is required'),
    body('type')
      .optional()
      .isIn(['blind', 'attended'])
      .withMessage('type must be "blind" or "attended"'),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });

      const { destination, domain, type = 'blind' } = req.body;
      const { uuid } = req.params;

      logger.info('Transfer request', { uuid, destination, domain, type });

      let result;
      if (type === 'attended') {
        result = await eslService.attendedTransfer(uuid, destination, domain);
        return res.json({
          success: true,
          message: `Attended transfer to ${destination} initiated`,
          originalUuid: result.originalUuid,
          newUuid: result.newUuid,
        });
      } else {
        await eslService.blindTransfer(uuid, destination, domain);
        return res.json({
          success: true,
          message: `Blind transfer to ${destination} executed`,
          uuid,
        });
      }
    } catch (err) {
      next(err);
    }
  }
);

// ─── DTMF ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/{uuid}/dtmf:
 *   post:
 *     summary: Send DTMF tones on a call
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uuid
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [digits]
 *             properties:
 *               digits:
 *                 type: string
 *                 example: "1234#"
 *     responses:
 *       200:
 *         description: DTMF sent
 */
router.post(
  '/:uuid/dtmf',
  [
    param('uuid').notEmpty().isUUID(),
    body('digits').notEmpty().matches(/^[0-9*#A-D]+$/).withMessage('Invalid DTMF digits'),
  ],
  validate,
  async (req, res, next) => {
    try {
      if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
      await eslService.sendDtmf(req.params.uuid, req.body.digits);
      res.json({ success: true, message: `DTMF ${req.body.digits} sent`, uuid: req.params.uuid });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Mute / Unmute ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/{uuid}/mute:
 *   post:
 *     summary: Mute a call channel
 *     tags: [Calls]
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
 *         description: Channel muted
 */
router.post('/:uuid/mute', [param('uuid').notEmpty().isUUID()], validate, async (req, res, next) => {
  try {
    if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
    await eslService.mute(req.params.uuid);
    res.json({ success: true, message: 'Channel muted', uuid: req.params.uuid });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/calls/{uuid}/unmute:
 *   post:
 *     summary: Unmute a call channel
 *     tags: [Calls]
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
 *         description: Channel unmuted
 */
router.post('/:uuid/unmute', [param('uuid').notEmpty().isUUID()], validate, async (req, res, next) => {
  try {
    if (!eslService.connected) return res.status(503).json({ error: 'ESL not connected' });
    await eslService.unmute(req.params.uuid);
    res.json({ success: true, message: 'Channel unmuted', uuid: req.params.uuid });
  } catch (err) {
    next(err);
  }
});

// ─── ESL Status ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/calls/esl/status:
 *   get:
 *     summary: Get ESL connection status
 *     tags: [Calls]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: ESL status
 */
router.get('/esl/status', (req, res) => {
  res.json(eslService.getStatus());
});

module.exports = router;
