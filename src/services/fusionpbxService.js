/**
 * FusionPBX REST API Service
 * Handles FusionPBX HTTP API calls for domain, extension,
 * and voicemail management.
 */

const axios = require('axios');
const https = require('https');
const config = require('../config/config');
const logger = require('../utils/logger');

class FusionPBXService {
  constructor() {
    this.client = axios.create({
      baseURL: config.fusionpbx.baseUrl,
      auth: {
        username: config.fusionpbx.username,
        password: config.fusionpbx.password,
      },
      timeout: 10000,
      // Allow self-signed certs on dev
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // Log requests in debug mode
    this.client.interceptors.request.use((req) => {
      logger.debug('FusionPBX API request', { method: req.method, url: req.url });
      return req;
    });

    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const data = err.response?.data;
        logger.error('FusionPBX API error', { status, data, message: err.message });
        throw err;
      }
    );
  }

  // ─── Health / Status ─────────────────────────────────────────────────────────

  async ping() {
    try {
      await this.client.get('/');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Domains ─────────────────────────────────────────────────────────────────

  async getDomains() {
    const res = await this.client.get('/api/v2/domains', {
      params: { enabled: 'true' },
    });
    return res.data;
  }

  async getDomain(domainName) {
    const res = await this.client.get(`/api/v2/domains/${domainName}`);
    return res.data;
  }

  // ─── Extensions ──────────────────────────────────────────────────────────────

  async getExtensions(domain) {
    const res = await this.client.get('/api/v2/extensions', {
      params: { domain_name: domain, enabled: 'true' },
    });
    return res.data;
  }

  async getExtension(extensionUuid) {
    const res = await this.client.get(`/api/v2/extensions/${extensionUuid}`);
    return res.data;
  }

  /**
   * True if an extension number already exists in the domain.
   * Reads the FusionPBX DB directly (via dbService) so duplicate detection is
   * authoritative regardless of REST API availability.
   */
  async extensionExists(extension, domain) {
    const dbService = require('./dbService');
    const row = await dbService.getExtensionByNumber(extension, domain);
    return !!row;
  }

  /**
   * Create a new SIP account under `domain` directly in the FusionPBX DB.
   *
   * The account gets:
   *   • a v_extensions row with a strong random SIP password (returned to the app
   *     so it can register), and
   *   • a v_users + v_extension_users pair whose (web/portal) password is the
   *     user's chosen password, stored as a bcrypt hash matching FusionPBX ($2y$).
   *
   * The whole thing runs in one transaction (see dbService.createExtensionRecords).
   * FreeSWITCH reads the directory from the DB, so no explicit reloadxml is needed
   * for registration to work.
   *
   * @param {object} o
   * @param {string} o.extension     desired extension/username
   * @param {string} o.password      user's chosen password (web login)
   * @param {string} o.domain
   * @param {string} [o.displayName]
   * @param {string} [o.email]
   * @returns {{ extension: string, password: string }}  password = SIP password
   */
  async createExtension({ extension, password, domain, displayName, email }) {
    const crypto = require('crypto');
    const bcrypt = require('bcryptjs');
    const dbService = require('./dbService');

    const domainUuid = await dbService.getDomainUuid(domain);
    if (!domainUuid) {
      throw new Error(`Domain "${domain}" not found or disabled in FusionPBX.`);
    }

    // Strong 20-char SIP password (matches the domain's extension password policy).
    const sipPassword = crypto.randomBytes(15).toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).padEnd(20, '0');

    // FusionPBX stores web-login passwords as bcrypt ($2y$ prefix, cost 10).
    const webHash = bcrypt.hashSync(password, 10).replace(/^\$2a\$/, '$2y$');

    await dbService.createExtensionRecords({
      domainUuid,
      domainName: domain,
      extension,
      sipPassword,
      webPasswordHash: webHash,
      email,
      displayName: displayName || extension,
      userContext: domain,
    });

    return { extension, password: sipPassword };
  }

  /**
   * Get-or-create a SIP account for a verified Google identity.
   *
   * Resolution order:
   *   1. If an extension is already tagged google:<sub>, return its creds (repeat
   *      sign-in → same account, new derived username never matters).
   *   2. Otherwise, if allowed to create, pick a free username derived from the
   *      email (disambiguating on collision) and provision it, tagging the
   *      extension description with google:<sub>.
   *
   * @param {object} o
   * @param {string} o.sub          Google subject (stable user id)
   * @param {string} o.email
   * @param {string} [o.name]
   * @param {string} o.domain
   * @param {string} o.baseUsername derived username seed
   * @param {boolean} o.allowCreate create if not found (signup, or signin autoprovision)
   * @returns {{ ok:boolean, created?:boolean, reason?:string, extension?:string, sipPassword?:string, displayName?:string }}
   */
  async provisionGoogle({ sub, email, name, domain, baseUsername, allowCreate }) {
    const crypto = require('crypto');
    const bcrypt = require('bcryptjs');
    const dbService = require('./dbService');

    // 1. Existing Google account for this sub?
    const existing = await dbService.getExtensionByGoogleSub(sub, domain);
    if (existing) {
      if (existing.ext_enabled !== 'true') return { ok: false, reason: 'disabled' };
      return {
        ok: true,
        created: false,
        extension: existing.extension,
        sipPassword: existing.sip_password,
        displayName: existing.display_name || existing.extension,
      };
    }

    if (!allowCreate) return { ok: false, reason: 'not_found' };

    const domainUuid = await dbService.getDomainUuid(domain);
    if (!domainUuid) throw new Error(`Domain "${domain}" not found or disabled in FusionPBX.`);

    // 2. Choose a free username: base, then base1, base2, … (respect 32-char cap).
    let username = baseUsername;
    for (let i = 0; i < 50; i++) {
      const taken = await dbService.getExtensionByNumber(username, domain);
      if (!taken) break;
      const suffix = String(i + 1);
      username = (baseUsername.slice(0, 32 - suffix.length)) + suffix;
      if (i === 49) throw new Error('Could not allocate a unique username for Google user.');
    }

    // Random SIP password + a random (unused) web password — Google users re-auth
    // via Google, not username/password, so the web hash just needs to be valid.
    const sipPassword = crypto.randomBytes(15).toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).padEnd(20, '0');
    const randomWebPw = crypto.randomBytes(24).toString('base64');
    const webHash = bcrypt.hashSync(randomWebPw, 10).replace(/^\$2a\$/, '$2y$');

    await dbService.createExtensionRecords({
      domainUuid,
      domainName: domain,
      extension: username,
      sipPassword,
      webPasswordHash: webHash,
      email,
      displayName: name || username,
      userContext: domain,
      description: `google:${sub}`,
    });

    return {
      ok: true,
      created: true,
      extension: username,
      sipPassword,
      displayName: name || username,
    };
  }

  /**
   * Verify a username/password against the FusionPBX user record and return the
   * SIP credentials on success.
   * @returns {{ ok:boolean, reason?:string, extension?:string, sipPassword?:string, displayName?:string }}
   */
  async signin({ username, password, domain }) {
    const bcrypt = require('bcryptjs');
    const dbService = require('./dbService');

    const row = await dbService.getAccountForSignin(username, domain);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.ext_enabled !== 'true') return { ok: false, reason: 'disabled' };

    // The user's web-login password is the bcrypt hash we can verify against.
    if (!row.web_password_hash) return { ok: false, reason: 'no_password' };
    // bcryptjs understands the $2y$ prefix FusionPBX uses.
    const match = bcrypt.compareSync(password, row.web_password_hash);
    if (!match) return { ok: false, reason: 'bad_password' };

    return {
      ok: true,
      extension: row.extension,
      sipPassword: row.sip_password,
      displayName: row.display_name || row.extension,
    };
  }

  // ─── Registrations ───────────────────────────────────────────────────────────

  /**
   * Get all registered SIP endpoints for a domain.
   */
  async getRegistrations(domain) {
    const res = await this.client.get('/api/v2/registrations', {
      params: { domain },
    });
    return res.data;
  }

  // ─── Voicemail ───────────────────────────────────────────────────────────────

  async getVoicemails(domain) {
    const res = await this.client.get('/api/v2/voicemails', {
      params: { domain_name: domain },
    });
    return res.data;
  }

  async getVoicemailMessages(extensionUuid) {
    const res = await this.client.get(`/api/v2/voicemail_messages`, {
      params: { voicemail_uuid: extensionUuid },
    });
    return res.data;
  }

  // ─── Call Center (Queues) ────────────────────────────────────────────────────

  async getCallQueues(domain) {
    const res = await this.client.get('/api/v2/call_center_queues', {
      params: { domain_name: domain },
    });
    return res.data;
  }

  async getCallQueueAgents(queueUuid) {
    const res = await this.client.get(`/api/v2/call_center_tiers`, {
      params: { queue_uuid: queueUuid },
    });
    return res.data;
  }

  // ─── Ring Groups ─────────────────────────────────────────────────────────────

  async getRingGroups(domain) {
    const res = await this.client.get('/api/v2/ring_groups', {
      params: { domain_name: domain },
    });
    return res.data;
  }

  // ─── IVR Menus ───────────────────────────────────────────────────────────────

  async getIVRMenus(domain) {
    const res = await this.client.get('/api/v2/ivr_menus', {
      params: { domain_name: domain },
    });
    return res.data;
  }
}

const fusionpbxService = new FusionPBXService();
module.exports = fusionpbxService;
