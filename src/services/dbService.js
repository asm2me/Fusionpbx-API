/**
 * PostgreSQL Database Service
 * Direct queries to FusionPBX database for CDR and extension data.
 */

const { Pool } = require('pg');
const config = require('../config/config');
const logger = require('../utils/logger');

class DBService {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  init() {
    this.pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl,
      max: config.db.max,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    });

    this.pool.on('connect', () => {
      this.connected = true;
      logger.info('Database pool connection established');
    });

    this.pool.on('error', (err) => {
      logger.error('Database pool error', { error: err.message });
    });
  }

  async query(text, params) {
    if (!this.pool) this.init();
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('DB query executed', { duration, rows: res.rowCount });
      return res;
    } catch (err) {
      logger.error('DB query error', { error: err.message, query: text });
      throw err;
    }
  }

  async testConnection() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ─── CDR Queries ─────────────────────────────────────────────────────────────

  /**
   * Get Call Detail Records with filters.
   */
  async getCDR({
    domain,
    startDate,
    endDate,
    direction,       // 'inbound' | 'outbound' | 'local'
    extension,
    limit = 100,
    offset = 0,
    searchNumber,
  }) {
    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (domain) {
      conditions.push(`domain_name = $${idx++}`);
      params.push(domain);
    }
    if (startDate) {
      conditions.push(`start_stamp >= $${idx++}`);
      params.push(new Date(startDate));
    }
    if (endDate) {
      conditions.push(`start_stamp <= $${idx++}`);
      params.push(new Date(endDate));
    }
    if (direction) {
      conditions.push(`direction = $${idx++}`);
      params.push(direction);
    }
    if (extension) {
      conditions.push(`(caller_id_number = $${idx} OR destination_number = $${idx})`);
      params.push(extension);
      idx++;
    }
    if (searchNumber) {
      conditions.push(`(caller_id_number ILIKE $${idx} OR destination_number ILIKE $${idx} OR caller_id_name ILIKE $${idx})`);
      params.push(`%${searchNumber}%`);
      idx++;
    }

    const where = conditions.join(' AND ');
    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));

    const sql = `
      SELECT
        xml_cdr_uuid,
        domain_name,
        direction,
        caller_id_name,
        caller_id_number,
        destination_number,
        context,
        start_stamp,
        answer_stamp,
        end_stamp,
        duration,
        billsec,
        hangup_cause,
        disposition,
        record_path,
        record_name,
        leg,
        pdd_ms,
        rtp_audio_in_mos,
        last_app,
        network_addr
      FROM v_xml_cdr
      WHERE ${where}
      ORDER BY start_stamp DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const result = await this.query(sql, params);
    return result.rows;
  }

  /**
   * Count CDR records with same filters.
   */
  async countCDR({ domain, startDate, endDate, direction, extension, searchNumber }) {
    const conditions = ['1=1'];
    const params = [];
    let idx = 1;

    if (domain) { conditions.push(`domain_name = $${idx++}`); params.push(domain); }
    if (startDate) { conditions.push(`start_stamp >= $${idx++}`); params.push(new Date(startDate)); }
    if (endDate) { conditions.push(`start_stamp <= $${idx++}`); params.push(new Date(endDate)); }
    if (direction) { conditions.push(`direction = $${idx++}`); params.push(direction); }
    if (extension) {
      conditions.push(`(caller_id_number = $${idx} OR destination_number = $${idx})`);
      params.push(extension); idx++;
    }
    if (searchNumber) {
      conditions.push(`(caller_id_number ILIKE $${idx} OR destination_number ILIKE $${idx} OR caller_id_name ILIKE $${idx})`);
      params.push(`%${searchNumber}%`); idx++;
    }

    const sql = `SELECT COUNT(*) FROM v_xml_cdr WHERE ${conditions.join(' AND ')}`;
    const result = await this.query(sql, params);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get a single CDR record by UUID.
   */
  async getCDRByUUID(uuid) {
    const sql = `SELECT * FROM v_xml_cdr WHERE xml_cdr_uuid = $1`;
    const result = await this.query(sql, [uuid]);
    return result.rows[0] || null;
  }

  // ─── Extensions ──────────────────────────────────────────────────────────────

  /**
   * Get all extensions for a domain.
   */
  async getExtensions(domain) {
    const sql = `
      SELECT
        extension_uuid,
        domain_name,
        extension,
        number_alias,
        effective_caller_id_name,
        effective_caller_id_number,
        outbound_caller_id_name,
        outbound_caller_id_number,
        directory_first_name,
        directory_last_name,
        voicemail_enabled,
        enabled
      FROM v_extensions
      WHERE domain_name = $1
        AND enabled = 'true'
      ORDER BY extension ASC
    `;
    const result = await this.query(sql, [domain]);
    return result.rows;
  }

  /**
   * Get a single extension by number.
   */
  async getExtensionByNumber(extension, domain) {
    const sql = `
      SELECT * FROM v_extensions
      WHERE extension = $1 AND domain_name = $2
    `;
    const result = await this.query(sql, [extension, domain]);
    return result.rows[0] || null;
  }

  // ─── Domains ─────────────────────────────────────────────────────────────────

  async getDomains() {
    const sql = `
      SELECT domain_uuid, domain_name, domain_enabled
      FROM v_domains
      WHERE domain_enabled = 'true'
      ORDER BY domain_name ASC
    `;
    const result = await this.query(sql);
    return result.rows;
  }

  // ─── Call Summary Stats ───────────────────────────────────────────────────────

  /**
   * Get call statistics summary for a domain/period.
   */
  async getCallStats({ domain, startDate, endDate }) {
    const params = [];
    let idx = 1;
    const conditions = ['1=1'];

    if (domain) { conditions.push(`domain_name = $${idx++}`); params.push(domain); }
    if (startDate) { conditions.push(`start_stamp >= $${idx++}`); params.push(new Date(startDate)); }
    if (endDate) { conditions.push(`start_stamp <= $${idx++}`); params.push(new Date(endDate)); }

    const where = conditions.join(' AND ');
    const sql = `
      SELECT
        direction,
        COUNT(*) AS total_calls,
        COUNT(CASE WHEN disposition = 'ANSWERED' THEN 1 END) AS answered_calls,
        COUNT(CASE WHEN disposition = 'NO ANSWER' THEN 1 END) AS missed_calls,
        COUNT(CASE WHEN disposition = 'BUSY' THEN 1 END) AS busy_calls,
        AVG(CASE WHEN billsec > 0 THEN billsec END)::numeric(10,2) AS avg_duration_sec,
        SUM(billsec) AS total_duration_sec,
        MAX(billsec) AS max_duration_sec
      FROM v_xml_cdr
      WHERE ${where}
      GROUP BY direction
    `;
    const result = await this.query(sql, params);
    return result.rows;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
    }
  }
}

const dbService = new DBService();
module.exports = dbService;
