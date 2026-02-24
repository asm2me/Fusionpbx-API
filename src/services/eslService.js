/**
 * FreeSWITCH ESL (Event Socket Library) Service
 * Handles all real-time call control operations:
 * - Originate calls
 * - Transfer (blind & attended)
 * - Hold / Unhold
 * - Hangup
 * - Active calls listing
 * - Real-time event subscription
 */

const esl = require('esl');
const { EventEmitter } = require('events');
const config = require('../config/config');
const logger = require('../utils/logger');

class ESLService extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.subscribed = false;
  }

  // ─── Connection Management ──────────────────────────────────────────────────

  async connect() {
    return new Promise((resolve, reject) => {
      logger.info('Connecting to FreeSWITCH ESL...', {
        host: config.esl.host,
        port: config.esl.port,
      });

      this.connection = new esl.Connection(
        config.esl.host,
        config.esl.port,
        config.esl.password,
        () => {
          logger.info('ESL connected and authenticated');
          this.connected = true;
          this.reconnectAttempts = 0;
          this._subscribeToEvents();
          this.emit('connected');
          resolve();
        }
      );

      this.connection.on('error', (err) => {
        logger.error('ESL connection error', { error: err.message });
        this.connected = false;
        this.emit('error', err);
        if (this.reconnectAttempts === 0) reject(err);
        this._scheduleReconnect();
      });

      this.connection.on('end', () => {
        logger.warn('ESL connection closed');
        this.connected = false;
        this.subscribed = false;
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      // Forward all FreeSWITCH events to our EventEmitter
      this.connection.on('esl::event::**', (evt) => {
        this._handleEvent(evt);
      });
    });
  }

  _subscribeToEvents() {
    if (!this.connection || this.subscribed) return;
    // Subscribe to all call-related events
    this.connection.subscribe([
      'CHANNEL_CREATE',
      'CHANNEL_ANSWER',
      'CHANNEL_HANGUP',
      'CHANNEL_HANGUP_COMPLETE',
      'CHANNEL_BRIDGE',
      'CHANNEL_UNBRIDGE',
      'CHANNEL_HOLD',
      'CHANNEL_UNHOLD',
      'CHANNEL_PARK',
      'CHANNEL_UNPARK',
      'CHANNEL_CALLSTATE',
      'CHANNEL_STATE',
      'DTMF',
      'CALL_UPDATE',
      'RECORD_START',
      'RECORD_STOP',
      'PLAYBACK_START',
      'PLAYBACK_STOP',
    ]);
    this.subscribed = true;
    logger.info('Subscribed to FreeSWITCH events');
  }

  _handleEvent(evt) {
    if (!evt) return;
    const eventName = evt.getHeader('Event-Name');
    const uniqueId = evt.getHeader('Unique-ID');
    const callerIdNumber = evt.getHeader('Caller-Caller-ID-Number');
    const calleeIdNumber = evt.getHeader('Caller-Callee-ID-Number') || evt.getHeader('variable_sip_to_user');
    const domain = evt.getHeader('variable_domain_name');
    const channelState = evt.getHeader('Channel-State');
    const answerState = evt.getHeader('Answer-State');
    const direction = evt.getHeader('Call-Direction');
    const hangupCause = evt.getHeader('Hangup-Cause');

    const payload = {
      event: eventName,
      uuid: uniqueId,
      callerNumber: callerIdNumber,
      calleeNumber: calleeIdNumber,
      domain,
      channelState,
      answerState,
      direction,
      hangupCause,
      timestamp: new Date().toISOString(),
      raw: evt.serialize('json'),
    };

    this.emit('call_event', payload);
    this.emit(`event:${eventName}`, payload);
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= config.esl.maxReconnectAttempts) {
      logger.error('ESL max reconnect attempts reached');
      this.emit('max_reconnect');
      return;
    }
    this.reconnectAttempts++;
    const delay = config.esl.reconnectDelay;
    logger.info(`ESL reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        // handled inside connect()
      }
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    this.connected = false;
  }

  // ─── ESL API Helper ─────────────────────────────────────────────────────────

  async _api(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.connection) {
        return reject(new Error('ESL not connected'));
      }
      this.connection.api(command, (res) => {
        const body = res.getBody();
        if (body && body.startsWith('-ERR')) {
          return reject(new Error(body.replace('-ERR ', '').trim()));
        }
        resolve(body);
      });
    });
  }

  async _bgapi(command) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.connection) {
        return reject(new Error('ESL not connected'));
      }
      this.connection.bgapi(command, (res) => {
        const body = res ? res.getBody() : '';
        resolve(body);
      });
    });
  }

  // ─── Call Operations ─────────────────────────────────────────────────────────

  /**
   * Originate (make) a call.
   * @param {object} opts
   * @param {string} opts.from       - SIP extension or number to call from
   * @param {string} opts.to         - Destination number/extension
   * @param {string} opts.domain     - FusionPBX domain
   * @param {string} [opts.callerId] - Override caller ID number
   * @param {string} [opts.callerName] - Override caller ID name
   * @param {number} [opts.timeout]  - Ring timeout in seconds (default 30)
   * @returns {Promise<{uuid: string}>}
   */
  async originateCall({ from, to, domain, callerId, callerName, timeout = 30 }) {
    const uuid = require('uuid').v4();
    const cidNum = callerId || from;
    const cidName = callerName || from;
    const dialString = [
      `{origination_uuid=${uuid}`,
      `origination_caller_id_number=${cidNum}`,
      `origination_caller_id_name=${cidName}`,
      `domain_name=${domain}`,
      `originate_timeout=${timeout}}`,
    ].join(',');

    const originateCmd = `originate ${dialString}sofia/internal/${from}@${domain} &bridge(sofia/internal/${to}@${domain})`;
    logger.info('Originating call', { from, to, domain, uuid });
    await this._bgapi(originateCmd);
    return { uuid };
  }

  /**
   * Hangup a call by UUID.
   * @param {string} uuid - Channel UUID
   * @param {string} [cause] - Hangup cause (default: NORMAL_CLEARING)
   */
  async hangup(uuid, cause = 'NORMAL_CLEARING') {
    logger.info('Hanging up call', { uuid, cause });
    return this._api(`uuid_kill ${uuid} ${cause}`);
  }

  /**
   * Hold a call (park it in local park).
   * @param {string} uuid - Channel UUID
   */
  async hold(uuid) {
    logger.info('Holding call', { uuid });
    return this._api(`uuid_hold ${uuid}`);
  }

  /**
   * Unhold a call.
   * @param {string} uuid - Channel UUID
   */
  async unhold(uuid) {
    logger.info('Unholding call', { uuid });
    return this._api(`uuid_hold off ${uuid}`);
  }

  /**
   * Toggle hold state.
   * @param {string} uuid - Channel UUID
   */
  async toggleHold(uuid) {
    logger.info('Toggling hold', { uuid });
    return this._api(`uuid_hold toggle ${uuid}`);
  }

  /**
   * Blind transfer - immediately redirects the call.
   * @param {string} uuid        - Channel UUID to transfer
   * @param {string} destination - Extension/number to transfer to
   * @param {string} domain      - FusionPBX domain
   */
  async blindTransfer(uuid, destination, domain) {
    logger.info('Blind transfer', { uuid, destination, domain });
    return this._api(`uuid_transfer ${uuid} ${destination} XML ${domain}`);
  }

  /**
   * Attended (warm) transfer - bridges the original call to a new leg.
   * Step 1: Originate a new call to the transfer target.
   * Step 2: Bridge the original UUID to the new leg.
   * @param {string} uuid        - Original channel UUID
   * @param {string} destination - Extension/number to transfer to
   * @param {string} domain      - FusionPBX domain
   */
  async attendedTransfer(uuid, destination, domain) {
    logger.info('Attended transfer', { uuid, destination, domain });
    // Put original on hold first
    await this.hold(uuid);
    // Originate new leg
    const newUuid = require('uuid').v4();
    const cmd = `originate {origination_uuid=${newUuid},domain_name=${domain}}sofia/internal/${destination}@${domain} &bridge(${uuid})`;
    await this._bgapi(cmd);
    return { originalUuid: uuid, newUuid };
  }

  /**
   * Send DTMF tones on a channel.
   * @param {string} uuid   - Channel UUID
   * @param {string} digits - DTMF digits string
   */
  async sendDtmf(uuid, digits) {
    logger.info('Sending DTMF', { uuid, digits });
    return this._api(`uuid_send_dtmf ${uuid} ${digits}`);
  }

  /**
   * Mute/unmute a channel's audio.
   * @param {string} uuid - Channel UUID
   * @param {'read'|'write'|'both'} [direction] - Which direction to mute
   */
  async mute(uuid, direction = 'write') {
    logger.info('Muting', { uuid, direction });
    return this._api(`uuid_audio ${uuid} start ${direction} mute`);
  }

  async unmute(uuid, direction = 'write') {
    logger.info('Unmuting', { uuid, direction });
    return this._api(`uuid_audio ${uuid} stop ${direction} mute`);
  }

  // ─── Channel / Call Listing ──────────────────────────────────────────────────

  /**
   * Get all active channels as JSON array.
   * @param {string} [domain] - Filter by domain
   */
  async getActiveChannels(domain) {
    const raw = await this._api('show channels as json');
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return [];
    }
    const rows = result.rows || [];
    if (domain) {
      return rows.filter(ch => (ch.context || '').includes(domain));
    }
    return rows;
  }

  /**
   * Get active calls (bridges) as JSON array.
   * @param {string} [domain] - Filter by domain
   */
  async getActiveCalls(domain) {
    const raw = await this._api('show calls as json');
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return [];
    }
    const rows = result.rows || [];
    if (domain) {
      return rows.filter(call => (call.context || '').includes(domain));
    }
    return rows;
  }

  /**
   * Get a single channel info by UUID.
   */
  async getChannelInfo(uuid) {
    const channels = await this.getActiveChannels();
    return channels.find(ch => ch.uuid === uuid) || null;
  }

  /**
   * Get the ESL connection status.
   */
  getStatus() {
    return {
      connected: this.connected,
      host: config.esl.host,
      port: config.esl.port,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Export singleton
const eslService = new ESLService();
module.exports = eslService;
