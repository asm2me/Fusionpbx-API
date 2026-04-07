/**
 * @swagger
 * tags:
 *   name: Tickets
 *   description: Support ticket management for mobile dialers
 */

const express = require('express');
const { query, param, body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const dbService = require('../services/dbService');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

router.use(authenticate);

/**
 * Generate a ticket number for a domain
 */
async function generateTicketNumber(domainUuid) {
  const result = await dbService.query(
    'SELECT count(*) + 1 AS next_num FROM v_tickets WHERE domain_uuid = $1',
    [domainUuid]
  );
  const num = result.rows[0]?.next_num || 1;
  return 'TKT-' + String(num).padStart(5, '0');
}

/**
 * @swagger
 * /api/tickets:
 *   post:
 *     summary: Create a new support ticket (with optional call details and activity log)
 *     tags: [Tickets]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 */
router.post('/',
  [
    body('domain').notEmpty().withMessage('Domain is required'),
    body('subject').notEmpty().withMessage('Subject is required'),
    body('source').optional().isIn(['panel', 'webphone', 'dialer']),
    body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
  ],
  validate,
  async (req, res, next) => {
    try {
      const {
        domain, subject, description, priority = 'normal', source = 'dialer',
        call_number, call_direction, call_duration, call_status, call_timestamp,
        extension, call_quality_mos, call_quality_rating, call_quality_issues,
        call_hangup_by, call_hangup_cause,
        activity_log, call_detail_json
      } = req.body;

      // Resolve domain_uuid
      const domainResult = await dbService.query(
        'SELECT domain_uuid FROM v_domains WHERE domain_name = $1',
        [domain]
      );
      if (domainResult.rows.length === 0) {
        return res.status(400).json({ error: 'domain_not_found' });
      }
      const domainUuid = domainResult.rows[0].domain_uuid;

      // Get user_uuid from the authenticated API key's domain
      const userUuid = req.user?.user_uuid || null;

      const ticketUuid = uuidv4();
      const ticketNumber = await generateTicketNumber(domainUuid);

      await dbService.query(
        `INSERT INTO v_tickets (
          ticket_uuid, domain_uuid, user_uuid, ticket_number, subject, description,
          status, priority, source, extension,
          call_number, call_direction, call_duration, call_status, call_timestamp,
          call_quality_mos, call_quality_rating, call_quality_issues,
          call_hangup_by, call_hangup_cause,
          insert_date, insert_user
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          'open', $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, $16, $17,
          $18, $19,
          now(), $3
        )`,
        [
          ticketUuid, domainUuid, userUuid, ticketNumber, subject, description || '',
          priority, source, extension || null,
          call_number || null, call_direction || null, parseInt(call_duration) || null,
          call_status || null, call_timestamp || null,
          call_quality_mos ? parseFloat(call_quality_mos) : null,
          call_quality_rating || null, call_quality_issues || null,
          call_hangup_by || null, call_hangup_cause || null
        ]
      );

      // Save activity log attachment
      if (activity_log) {
        const logData = typeof activity_log === 'object' ? JSON.stringify(activity_log) : activity_log;
        await dbService.query(
          `INSERT INTO v_ticket_attachments
          (ticket_attachment_uuid, ticket_uuid, domain_uuid, file_name, file_type, file_content, attachment_type, insert_date, insert_user)
          VALUES ($1, $2, $3, 'activity_log.json', 'application/json', $4, 'activity_log', now(), $5)`,
          [uuidv4(), ticketUuid, domainUuid, logData, userUuid]
        );
      }

      // Save call detail attachment
      if (call_detail_json) {
        const detailData = typeof call_detail_json === 'object' ? JSON.stringify(call_detail_json) : call_detail_json;
        await dbService.query(
          `INSERT INTO v_ticket_attachments
          (ticket_attachment_uuid, ticket_uuid, domain_uuid, file_name, file_type, file_content, attachment_type, insert_date, insert_user)
          VALUES ($1, $2, $3, 'call_details.json', 'application/json', $4, 'call_detail', now(), $5)`,
          [uuidv4(), ticketUuid, domainUuid, detailData, userUuid]
        );
      }

      // Log initial status
      await dbService.query(
        `INSERT INTO v_ticket_status_log
        (ticket_status_log_uuid, ticket_uuid, domain_uuid, old_status, new_status, changed_by, insert_date)
        VALUES ($1, $2, $3, NULL, 'open', $4, now())`,
        [uuidv4(), ticketUuid, domainUuid, userUuid]
      );

      res.json({
        status: 'success',
        ticket_uuid: ticketUuid,
        ticket_number: ticketNumber
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/tickets:
 *   get:
 *     summary: List tickets for a domain
 *     tags: [Tickets]
 */
router.get('/',
  [
    query('domain').notEmpty().withMessage('Domain is required'),
    query('status').optional().isIn(['open', 'in_progress', 'answered', 'resolved', 'closed']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { domain, status, limit = 50, offset = 0 } = req.query;

      const domainResult = await dbService.query(
        'SELECT domain_uuid FROM v_domains WHERE domain_name = $1',
        [domain]
      );
      if (domainResult.rows.length === 0) {
        return res.status(400).json({ error: 'domain_not_found' });
      }
      const domainUuid = domainResult.rows[0].domain_uuid;

      let sql = `SELECT ticket_uuid, ticket_number, subject, status, priority, source,
                  call_number, call_direction, extension, insert_date, update_date
                  FROM v_tickets WHERE domain_uuid = $1`;
      const params = [domainUuid];
      let paramIdx = 2;

      if (status) {
        sql += ` AND status = $${paramIdx}`;
        params.push(status);
        paramIdx++;
      }

      sql += ` ORDER BY insert_date DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(parseInt(limit), parseInt(offset));

      const result = await dbService.query(sql, params);

      res.json({
        tickets: result.rows,
        count: result.rows.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/tickets/{uuid}:
 *   get:
 *     summary: Get ticket detail with replies
 *     tags: [Tickets]
 */
router.get('/:uuid',
  [param('uuid').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const { uuid } = req.params;

      const ticketResult = await dbService.query(
        'SELECT * FROM v_tickets WHERE ticket_uuid = $1',
        [uuid]
      );

      if (ticketResult.rows.length === 0) {
        return res.status(404).json({ error: 'not_found' });
      }

      const repliesResult = await dbService.query(
        `SELECT r.*, u.username FROM v_ticket_replies r
         LEFT JOIN v_users u ON u.user_uuid = r.user_uuid
         WHERE r.ticket_uuid = $1 ORDER BY r.insert_date ASC`,
        [uuid]
      );

      const attachResult = await dbService.query(
        `SELECT ticket_attachment_uuid, file_name, file_type, attachment_type, insert_date
         FROM v_ticket_attachments WHERE ticket_uuid = $1 ORDER BY insert_date ASC`,
        [uuid]
      );

      res.json({
        ticket: ticketResult.rows[0],
        replies: repliesResult.rows,
        attachments: attachResult.rows
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/tickets/{uuid}/reply:
 *   post:
 *     summary: Add a reply to a ticket
 *     tags: [Tickets]
 */
router.post('/:uuid/reply',
  [
    param('uuid').isUUID(),
    body('reply_text').notEmpty().withMessage('Reply text is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { uuid } = req.params;
      const { reply_text } = req.body;
      const userUuid = req.user?.user_uuid || null;
      const isAdmin = req.user?.is_admin || false;

      // Verify ticket exists
      const ticketResult = await dbService.query(
        'SELECT status, domain_uuid FROM v_tickets WHERE ticket_uuid = $1',
        [uuid]
      );

      if (ticketResult.rows.length === 0) {
        return res.status(404).json({ error: 'not_found' });
      }

      if (ticketResult.rows[0].status === 'closed') {
        return res.status(400).json({ error: 'ticket_closed' });
      }

      const replyUuid = uuidv4();
      const domainUuid = ticketResult.rows[0].domain_uuid;

      await dbService.query(
        `INSERT INTO v_ticket_replies
        (ticket_reply_uuid, ticket_uuid, domain_uuid, user_uuid, reply_text, is_admin, insert_date, insert_user)
        VALUES ($1, $2, $3, $4, $5, $6, now(), $4)`,
        [replyUuid, uuid, domainUuid, userUuid, reply_text, isAdmin]
      );

      res.json({ status: 'success', reply_uuid: replyUuid });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * @swagger
 * /api/tickets/updates:
 *   get:
 *     summary: Get ticket status updates since a timestamp (for polling from dialer)
 *     tags: [Tickets]
 */
router.get('/updates/poll',
  [
    query('domain').notEmpty().withMessage('Domain is required'),
    query('since').optional(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { domain, since } = req.query;
      const userUuid = req.user?.user_uuid || null;

      const domainResult = await dbService.query(
        'SELECT domain_uuid FROM v_domains WHERE domain_name = $1',
        [domain]
      );
      if (domainResult.rows.length === 0) {
        return res.status(400).json({ error: 'domain_not_found' });
      }
      const domainUuid = domainResult.rows[0].domain_uuid;

      const sinceDate = since || new Date(Date.now() - 86400000).toISOString();

      const result = await dbService.query(
        `SELECT t.ticket_uuid, t.ticket_number, t.subject, t.status, t.call_number,
                t.resolved_note, t.update_date, l.old_status, l.new_status, l.note AS status_note
         FROM v_tickets t
         JOIN v_ticket_status_log l ON l.ticket_uuid = t.ticket_uuid
         WHERE t.domain_uuid = $1
         AND t.user_uuid = $2
         AND l.insert_date > $3
         AND l.new_status IN ('answered', 'resolved', 'closed')
         ORDER BY l.insert_date DESC LIMIT 20`,
        [domainUuid, userUuid, sinceDate]
      );

      res.json({
        updates: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
