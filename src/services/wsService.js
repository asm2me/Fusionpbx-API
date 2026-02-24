/**
 * WebSocket Service
 * Pushes real-time FreeSWITCH call events to connected CRM clients.
 *
 * Protocol:
 *  - Client connects with: ws://host:port/ws?token=<jwt_or_api_key>&domain=<domain>
 *  - Server sends JSON messages: { type, data, timestamp }
 *
 * Message types pushed to CRM:
 *  - call.created    - New inbound/outbound call started
 *  - call.answered   - Call was answered
 *  - call.held       - Call placed on hold
 *  - call.unheld     - Call taken off hold
 *  - call.bridged    - Two-party call connected
 *  - call.unbridged  - Call legs separated
 *  - call.hangup     - Call ended
 *  - call.dtmf       - DTMF digit received
 *  - channel.update  - Generic channel state change
 *  - system.status   - ESL connection status
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const eslService = require('./eslService');
const logger = require('../utils/logger');

const EVENT_MAP = {
  CHANNEL_CREATE: 'call.created',
  CHANNEL_ANSWER: 'call.answered',
  CHANNEL_HOLD: 'call.held',
  CHANNEL_UNHOLD: 'call.unheld',
  CHANNEL_BRIDGE: 'call.bridged',
  CHANNEL_UNBRIDGE: 'call.unbridged',
  CHANNEL_HANGUP_COMPLETE: 'call.hangup',
  DTMF: 'call.dtmf',
  CHANNEL_CALLSTATE: 'channel.update',
};

class WSService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // clientId -> { ws, domain, userId }
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    logger.info('WebSocket server initialized at /ws');

    this.wss.on('connection', (ws, req) => this._onConnection(ws, req));

    // Forward ESL events to WebSocket clients
    eslService.on('call_event', (payload) => this._broadcast(payload));

    // Broadcast ESL connection status changes
    eslService.on('connected', () => {
      this._broadcastSystem({ status: 'connected', message: 'ESL connected' });
    });
    eslService.on('disconnected', () => {
      this._broadcastSystem({ status: 'disconnected', message: 'ESL disconnected - reconnecting' });
    });
  }

  // ─── Connection Handling ─────────────────────────────────────────────────────

  _onConnection(ws, req) {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const token = params.get('token');
    const domain = params.get('domain');

    const auth = this._authenticate(token);
    if (!auth) {
      logger.warn('WS connection rejected - invalid token');
      ws.close(4401, 'Unauthorized');
      return;
    }

    const clientId = `${auth.userId || 'anon'}_${Date.now()}`;
    this.clients.set(clientId, { ws, domain, userId: auth.userId });

    logger.info('WS client connected', { clientId, domain });

    // Send initial status
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
      logger.debug('WS message received', { clientId, type: msg.type });

      switch (msg.type) {
        case 'ping':
          this._send(ws, { type: 'pong', data: { ts: Date.now() } });
          break;
        case 'subscribe':
          // Client can update domain filter dynamically
          if (msg.domain && this.clients.has(clientId)) {
            this.clients.get(clientId).domain = msg.domain;
          }
          break;
        default:
          break;
      }
    } catch {
      // ignore non-JSON messages
    }
  }

  // ─── Broadcasting ─────────────────────────────────────────────────────────────

  _broadcast(eslPayload) {
    const msgType = EVENT_MAP[eslPayload.event] || 'channel.update';
    const message = {
      type: msgType,
      data: eslPayload,
      timestamp: eslPayload.timestamp,
    };

    this.clients.forEach(({ ws, domain }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Filter by domain if client specified one
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

  // ─── Auth ────────────────────────────────────────────────────────────────────

  _authenticate(token) {
    if (!token) return null;
    // Accept API key
    if (token === config.auth.apiKey) {
      return { userId: 'api-key-user' };
    }
    // Accept JWT
    try {
      return jwt.verify(token, config.auth.jwtSecret);
    } catch {
      return null;
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────────

  getConnectedClients() {
    return Array.from(this.clients.entries()).map(([id, { domain, userId }]) => ({
      id,
      domain,
      userId,
    }));
  }
}

const wsService = new WSService();
module.exports = wsService;
