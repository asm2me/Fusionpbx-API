/**
 * WebSocket Service
 * Pushes real-time FreeSWITCH call events to connected CRM clients.
 *
 * Protocol:
 *  ws://host:port/ws?token=<api_key_or_jwt>[&domain=<domain>]
 *
 * Message types pushed to CRM:
 *  call.created | call.answered | call.held | call.unheld |
 *  call.bridged | call.unbridged | call.hangup | call.dtmf |
 *  channel.update | system.status
 */

const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const config    = require('../config/config');
const eslService = require('./eslService');
const logger    = require('../utils/logger');

const EVENT_MAP = {
  CHANNEL_CREATE:          'call.created',
  CHANNEL_ANSWER:          'call.answered',
  CHANNEL_HOLD:            'call.held',
  CHANNEL_UNHOLD:          'call.unheld',
  CHANNEL_BRIDGE:          'call.bridged',
  CHANNEL_UNBRIDGE:        'call.unbridged',
  CHANNEL_HANGUP_COMPLETE: 'call.hangup',
  DTMF:                    'call.dtmf',
  CHANNEL_CALLSTATE:       'channel.update',
};

class WSService {
  constructor() {
    this.wss     = null;
    this.clients = new Map(); // clientId -> { ws, domain, userId, admin }
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    logger.info('WebSocket server initialized at /ws');

    // Wrap async _onConnection so errors don't crash the process
    this.wss.on('connection', (ws, req) => {
      this._onConnection(ws, req).catch((err) => {
        logger.error('WS connection handler error', { error: err.message });
        if (ws.readyState === WebSocket.OPEN) ws.close(4500, 'Internal error');
      });
    });

    eslService.on('call_event', (payload) => this._broadcast(payload));
    eslService.on('connected',  () => this._broadcastSystem({ status: 'connected',    message: 'ESL connected' }));
    eslService.on('disconnected', () => this._broadcastSystem({ status: 'disconnected', message: 'ESL disconnected - reconnecting' }));
  }

  // ─── Connection Handling ─────────────────────────────────────────────────────

  async _onConnection(ws, req) {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const token  = params.get('token');

    const auth = await this._authenticate(token);
    if (!auth) {
      logger.warn('WS connection rejected - invalid token', { ip: req.socket?.remoteAddress });
      ws.close(4401, 'Unauthorized');
      return;
    }

    // Domain locking: API key users are locked; admin users may filter via ?domain=
    const domain = auth.admin
      ? (params.get('domain') || null)
      : auth.domain;

    const clientId = `${auth.userId || 'anon'}_${Date.now()}`;
    this.clients.set(clientId, { ws, domain, userId: auth.userId, admin: !!auth.admin });

    logger.info('WS client connected', { clientId, domain, userId: auth.userId });

    this._send(ws, {
      type: 'system.status',
      data: {
        eslConnected: eslService.connected,
        domain,
        message: 'Connected to FusionPBX API Bridge',
      },
    });

    ws.on('message', (msg) => this._onMessage(ws, clientId, msg));

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.info('WS client disconnected', { clientId });
    });

    ws.on('error', (err) => {
      logger.error('WS client error', { clientId, error: err.message });
      this.clients.delete(clientId);
    });

    // Keepalive ping every 30s
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  }

  _onMessage(ws, clientId, rawMsg) {
    try {
      const msg = JSON.parse(rawMsg.toString());
      switch (msg.type) {
        case 'ping':
          this._send(ws, { type: 'pong', data: { ts: Date.now() } });
          break;
        case 'subscribe':
          // Only admin clients may change their domain filter dynamically
          if (msg.domain && this.clients.has(clientId)) {
            const client = this.clients.get(clientId);
            if (client.admin) client.domain = msg.domain;
          }
          break;
        default:
          break;
      }
    } catch {
      // ignore non-JSON
    }
  }

  // ─── Broadcasting ─────────────────────────────────────────────────────────────

  _broadcast(eslPayload) {
    const msgType = EVENT_MAP[eslPayload.event] || 'channel.update';
    const message = { type: msgType, data: eslPayload, timestamp: eslPayload.timestamp };

    this.clients.forEach(({ ws, domain }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (domain && eslPayload.domain && !eslPayload.domain.includes(domain)) return;
      this._send(ws, message);
    });
  }

  _broadcastSystem(data) {
    const message = { type: 'system.status', data, timestamp: new Date().toISOString() };
    this.clients.forEach(({ ws }) => {
      if (ws.readyState === WebSocket.OPEN) this._send(ws, message);
    });
  }

  _send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      logger.error('WS send error', { error: err.message });
    }
  }

  // ─── Auth (async — DB-backed) ─────────────────────────────────────────────────

  async _authenticate(token) {
    if (!token) return null;

    // Bootstrap admin key (env)
    if (config.auth.adminApiKey && token === config.auth.adminApiKey) {
      return { userId: 'admin', admin: true, domain: null };
    }

    // JWT Bearer
    if (!token.startsWith('fpx_')) {
      try {
        const decoded = jwt.verify(token, config.auth.jwtSecret);
        return { userId: decoded.userId, domain: decoded.domain, admin: !!decoded.admin };
      } catch {
        return null;
      }
    }

    // DB-backed API key (fpx_ prefix)
    try {
      const dbService = require('./dbService');
      const keyData   = await dbService.lookupApiKey(token);
      if (!keyData) return null;
      // fire-and-forget last_used update
      dbService.updateApiKeyLastUsed(keyData.api_key_uuid).catch(() => {});
      return {
        userId: keyData.username,
        domain: keyData.domain_name,
        admin:  keyData.is_admin,
      };
    } catch (err) {
      logger.error('WS DB key lookup error', { error: err.message });
      return null;
    }
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  getConnectedClients() {
    return Array.from(this.clients.entries()).map(([id, { domain, userId }]) => ({
      id, domain, userId,
    }));
  }
}

const wsService = new WSService();
module.exports = wsService;
