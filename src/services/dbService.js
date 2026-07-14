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
        e.extension_uuid,
        d.domain_name,
        e.extension,
        e.number_alias,
        e.effective_caller_id_name,
        e.effective_caller_id_number,
        e.outbound_caller_id_name,
        e.outbound_caller_id_number,
        e.directory_first_name,
        e.directory_last_name,
        e.enabled
      FROM v_extensions e
      JOIN v_domains d ON d.domain_uuid = e.domain_uuid
      WHERE d.domain_name = $1
        AND e.enabled = 'true'
      ORDER BY e.extension ASC
    `;
    const result = await this.query(sql, [domain]);
    return result.rows;
  }

  /**
   * Get a single extension by number within a domain.
   * v_extensions has no domain_name column, so join v_domains on domain_uuid.
   */
  async getExtensionByNumber(extension, domain) {
    const sql = `
      SELECT e.*
      FROM v_extensions e
      JOIN v_domains d ON d.domain_uuid = e.domain_uuid
      WHERE e.extension = $1 AND d.domain_name = $2
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

  // ─── API Key Management ───────────────────────────────────────────────────────

  /**
   * Look up an API key by its SHA-256 hash.
   * Returns key record or null if not found / disabled / expired.
   *
   * @param {string} rawKey  Plain-text key from the request header
   * @returns {object|null}  { api_key_uuid, domain_name, username, user_uuid, is_admin }
   */
  async lookupApiKey(rawKey) {
    const hash = require('crypto').createHash('sha256').update(rawKey).digest('hex');
    const sql = `
      SELECT api_key_uuid, domain_name, username, user_uuid, is_admin
      FROM v_api_keys
      WHERE api_key_hash = $1
        AND enabled = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const result = await this.query(sql, [hash]);
    return result.rows[0] || null;
  }

  /**
   * Create a new API key for a FusionPBX user.
   * Generates a cryptographically random key, stores only its hash.
   *
   * @param {object} opts
   * @param {string} opts.userUuid     FusionPBX user UUID
   * @param {string} opts.domainUuid   FusionPBX domain UUID
   * @param {string} opts.domainName   Domain name string
   * @param {string} opts.username     FusionPBX username
   * @param {string} [opts.description]
   * @param {boolean} [opts.isAdmin]   Cross-domain admin key
   * @param {Date}   [opts.expiresAt]  Optional expiry date
   * @returns {{ plainKey: string, record: object }}
   *   plainKey is shown ONCE – it is not stored anywhere after this call.
   */
  async createApiKey({ userUuid, domainUuid, domainName, username, description, isAdmin = false, expiresAt }) {
    const crypto = require('crypto');

    // Generate key: fpx_ + 32 random bytes as hex = 68 chars total
    const plainKey = 'fpx_' + crypto.randomBytes(32).toString('hex');
    const hash     = crypto.createHash('sha256').update(plainKey).digest('hex');
    const prefix   = plainKey.slice(0, 12);   // "fpx_" + first 8 hex chars

    const sql = `
      INSERT INTO v_api_keys
        (user_uuid, domain_uuid, domain_name, username, api_key_hash, key_prefix,
         description, is_admin, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING api_key_uuid, domain_name, username, key_prefix, description,
                is_admin, enabled, created_at, expires_at
    `;
    const result = await this.query(sql, [
      userUuid, domainUuid, domainName, username,
      hash, prefix, description || null, isAdmin, expiresAt || null,
    ]);

    return { plainKey, record: result.rows[0] };
  }

  /**
   * List API keys for a domain (or all domains for admin).
   * Never returns the key hash or plain key.
   *
   * @param {string|null} domainName  null = return all domains (admin only)
   */
  async listApiKeys(domainName) {
    const conditions = [];
    const params = [];
    if (domainName) {
      conditions.push(`k.domain_name = $1`);
      params.push(domainName);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT
        k.api_key_uuid,
        k.domain_name,
        k.username,
        k.key_prefix,
        k.description,
        k.is_admin,
        k.enabled,
        k.last_used_at,
        k.created_at,
        k.expires_at
      FROM v_api_keys k
      ${where}
      ORDER BY k.domain_name, k.created_at DESC
    `;
    const result = await this.query(sql, params);
    return result.rows;
  }

  /**
   * Revoke (hard-delete) an API key by UUID.
   * Optionally scope to a domain to prevent cross-domain revocation.
   */
  async revokeApiKey(apiKeyUuid, domainName) {
    const params = [apiKeyUuid];
    let sql = `DELETE FROM v_api_keys WHERE api_key_uuid = $1`;
    if (domainName) {
      sql += ` AND domain_name = $2`;
      params.push(domainName);
    }
    sql += ' RETURNING api_key_uuid';
    const result = await this.query(sql, params);
    return result.rowCount > 0;
  }

  /**
   * Enable or disable an API key without deleting it.
   */
  async setApiKeyEnabled(apiKeyUuid, enabled, domainName) {
    const params = [enabled, apiKeyUuid];
    let sql = `UPDATE v_api_keys SET enabled = $1 WHERE api_key_uuid = $2`;
    if (domainName) {
      sql += ` AND domain_name = $3`;
      params.push(domainName);
    }
    sql += ' RETURNING api_key_uuid';
    const result = await this.query(sql, params);
    return result.rowCount > 0;
  }

  /**
   * Update last_used_at timestamp (fire-and-forget, errors are suppressed).
   */
  async updateApiKeyLastUsed(apiKeyUuid) {
    const sql = `UPDATE v_api_keys SET last_used_at = NOW() WHERE api_key_uuid = $1`;
    await this.query(sql, [apiKeyUuid]);
  }

  /**
   * Validate that a FusionPBX user exists in a given domain.
   * Used when creating API keys to ensure the user/domain pair is real.
   */
  async getFusionPBXUser(username, domainName) {
    const sql = `
      SELECT u.user_uuid, u.username, d.domain_uuid, d.domain_name
      FROM v_users u
      JOIN v_domains d ON d.domain_uuid = u.domain_uuid
      WHERE u.username = $1
        AND d.domain_name = $2
        AND u.user_enabled = 'true'
        AND d.domain_enabled = 'true'
    `;
    const result = await this.query(sql, [username, domainName]);
    return result.rows[0] || null;
  }

  /**
   * Fetch the data needed to sign a user in: the extension's SIP password plus
   * the linked user's web-login bcrypt hash, for a username within a domain.
   * Returns null if the extension/user isn't found.
   */
  async getAccountForSignin(username, domainName) {
    const sql = `
      SELECT
        e.extension                      AS extension,
        e.password                       AS sip_password,
        e.effective_caller_id_name       AS display_name,
        e.enabled                        AS ext_enabled,
        u.password                       AS web_password_hash,
        u.user_enabled                   AS user_enabled
      FROM v_extensions e
      JOIN v_domains d ON d.domain_uuid = e.domain_uuid
      LEFT JOIN v_extension_users eu ON eu.extension_uuid = e.extension_uuid
      LEFT JOIN v_users u ON u.user_uuid = eu.user_uuid
      WHERE e.extension = $1 AND d.domain_name = $2
      LIMIT 1
    `;
    const result = await this.query(sql, [username, domainName]);
    return result.rows[0] || null;
  }

  /**
   * Find an extension previously provisioned for a Google identity, tagged in the
   * extension's description as "google:<sub>". Lets repeat Google sign-in resolve
   * back to the same account regardless of the derived username.
   */
  async getExtensionByGoogleSub(sub, domainName) {
    const sql = `
      SELECT e.extension AS extension,
             e.password  AS sip_password,
             e.effective_caller_id_name AS display_name,
             e.enabled   AS ext_enabled
      FROM v_extensions e
      JOIN v_domains d ON d.domain_uuid = e.domain_uuid
      WHERE d.domain_name = $1 AND e.description = $2
      LIMIT 1
    `;
    const result = await this.query(sql, [domainName, `google:${sub}`]);
    return result.rows[0] || null;
  }

  /**
   * Resolve a domain UUID by name.
   */
  async getDomainUuid(domainName) {
    const res = await this.query(
      `SELECT domain_uuid FROM v_domains WHERE domain_name = $1 AND domain_enabled = 'true'`,
      [domainName]
    );
    return res.rows[0]?.domain_uuid || null;
  }

  /**
   * Create a full FusionPBX SIP account in one transaction:
   *   • v_extensions      – the SIP-registerable extension (authoritative for auth)
   *   • v_users           – FusionPBX user (web/portal login), bcrypt password
   *   • v_extension_users – links the user to the extension
   *
   * @param {object} o
   * @param {string} o.domainUuid
   * @param {string} o.domainName
   * @param {string} o.extension        extension number / SIP username
   * @param {string} o.sipPassword      SIP auth password (v_extensions.password)
   * @param {string} o.webPasswordHash  bcrypt hash for v_users.password
   * @param {string} [o.email]
   * @param {string} [o.displayName]
   * @param {string} o.userContext      usually the domain name
   * @param {number} [o.callTimeout=30]
   * @param {number} [o.maxRegistrations=5]
   * @returns {{ extensionUuid: string, userUuid: string }}
   */
  async createExtensionRecords(o) {
    const { randomUUID } = require('crypto');
    const extensionUuid = randomUUID();
    const userUuid = randomUUID();
    const extUserUuid = randomUUID();
    const display = o.displayName || o.extension;
    const ctx = o.userContext || o.domainName;
    const callTimeout = o.callTimeout ?? 30;
    const maxReg = o.maxRegistrations ?? 5;
    const description = o.description || 'Self-service signup';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO v_extensions
           (extension_uuid, domain_uuid, extension, password, accountcode,
            user_context, effective_caller_id_name, effective_caller_id_number,
            outbound_caller_id_name, outbound_caller_id_number,
            directory_visible, directory_exten_visible,
            max_registrations, limit_max, call_timeout,
            enabled, description, insert_date, insert_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,$8,'true','true',$9,$10,$11,'true',
                 $12, now(), $1)`,
        [extensionUuid, o.domainUuid, o.extension, o.sipPassword, o.extension,
         ctx, display, o.extension, String(maxReg), '5', String(callTimeout), description]
      );

      await client.query(
        `INSERT INTO v_users
           (user_uuid, domain_uuid, username, password, salt, user_email,
            user_status, user_type, user_enabled, insert_date, insert_user)
         VALUES ($1,$2,$3,$4,'',$5,'','default','true', now(), $1)`,
        [userUuid, o.domainUuid, o.extension, o.webPasswordHash, o.email || null]
      );

      await client.query(
        `INSERT INTO v_extension_users
           (extension_user_uuid, domain_uuid, extension_uuid, user_uuid,
            insert_date, insert_user)
         VALUES ($1,$2,$3,$4, now(), $4)`,
        [extUserUuid, o.domainUuid, extensionUuid, userUuid]
      );

      await client.query('COMMIT');
      return { extensionUuid, userUuid };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
