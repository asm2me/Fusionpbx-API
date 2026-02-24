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
