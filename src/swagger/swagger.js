/**
 * Static OpenAPI 3.0 Specification
 * No swagger-jsdoc dependency.
 */
const config = require('../config/config');

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'FusionPBX API Bridge',
    version: '1.0.0',
    description: `
## FusionPBX CRM Integration API

Connect your CRM to FusionPBX/FreeSWITCH for:
- **Real-time call control**: originate, hold, unhold, transfer, hangup, mute, DTMF
- **Call activity**: live active channels and bridged calls
- **CDR**: historical call records with date/extension/direction filtering
- **Extensions**: directory and SIP registration status
- **WebSocket**: push call events to CRM in real-time

### Authentication
| Method | How |
|--------|-----|
| API Key | \`X-API-Key: <your-key>\` header |
| JWT | \`Authorization: Bearer <token>\` — obtain via POST /api/auth/token |

### WebSocket
\`ws://host:port/ws?token=<key_or_jwt>&domain=<domain>\`
    `,
    contact: { name: 'API Support' },
  },
  servers: [
    { url: `http://localhost:${config.server.port}`, description: 'Local development' },
  ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        OriginateRequest: {
          type: 'object',
          required: ['from', 'to', 'domain'],
          properties: {
            from: {
              type: 'string',
              description: 'Source SIP extension or number',
              example: '1001',
            },
            to: {
              type: 'string',
              description: 'Destination extension or PSTN number',
              example: '1002',
            },
            domain: {
              type: 'string',
              description: 'FusionPBX domain',
              example: 'company.example.com',
            },
            callerId: {
              type: 'string',
              description: 'Override caller ID number',
              example: '5551234567',
            },
            callerName: {
              type: 'string',
              description: 'Override caller ID name',
              example: 'John Doe',
            },
            timeout: {
              type: 'integer',
              description: 'Ring timeout in seconds',
              default: 30,
              minimum: 5,
              maximum: 120,
            },
          },
        },
        TransferRequest: {
          type: 'object',
          required: ['destination', 'domain'],
          properties: {
            destination: {
              type: 'string',
              description: 'Extension or number to transfer to',
              example: '1003',
            },
            domain: {
              type: 'string',
              description: 'FusionPBX domain',
              example: 'company.example.com',
            },
            type: {
              type: 'string',
              enum: ['blind', 'attended'],
              default: 'blind',
              description: 'blind = immediate redirect; attended = warm transfer (hold original, dial new)',
            },
          },
        },
        ActiveCall: {
          type: 'object',
          properties: {
            uuid: { type: 'string' },
            direction: { type: 'string' },
            created: { type: 'string' },
            created_epoch: { type: 'string' },
            name: { type: 'string' },
            state: { type: 'string' },
            cid_name: { type: 'string' },
            cid_num: { type: 'string' },
            ip_addr: { type: 'string' },
            dest: { type: 'string' },
            application: { type: 'string' },
            application_data: { type: 'string' },
            dialplan: { type: 'string' },
            context: { type: 'string' },
            read_codec: { type: 'string' },
            read_rate: { type: 'string' },
            write_codec: { type: 'string' },
            write_rate: { type: 'string' },
            secure: { type: 'string' },
            hostname: { type: 'string' },
            presence_id: { type: 'string' },
            callstate: { type: 'string' },
            callee_name: { type: 'string' },
            callee_num: { type: 'string' },
            sent_callee_name: { type: 'string' },
            sent_callee_num: { type: 'string' },
            b_uuid: { type: 'string' },
            b_direction: { type: 'string' },
          },
        },
        CDRRecord: {
          type: 'object',
          properties: {
            xml_cdr_uuid: { type: 'string' },
            domain_name: { type: 'string' },
            direction: { type: 'string', enum: ['inbound', 'outbound', 'local'] },
            caller_id_name: { type: 'string' },
            caller_id_number: { type: 'string' },
            destination_number: { type: 'string' },
            start_stamp: { type: 'string', format: 'date-time' },
            answer_stamp: { type: 'string', format: 'date-time' },
            end_stamp: { type: 'string', format: 'date-time' },
            duration: { type: 'integer', description: 'Total duration in seconds' },
            billsec: { type: 'integer', description: 'Billable seconds (after answer)' },
            hangup_cause: { type: 'string' },
            disposition: { type: 'string', enum: ['ANSWERED', 'NO ANSWER', 'BUSY', 'FAILED'] },
            record_path: { type: 'string' },
            record_name: { type: 'string' },
            rtp_audio_in_mos: { type: 'number', description: 'Mean Opinion Score for audio quality' },
          },
        },
        CallEvent: {
          type: 'object',
          description: 'WebSocket push event',
          properties: {
            type: {
              type: 'string',
              enum: [
                'call.created', 'call.answered', 'call.held', 'call.unheld',
                'call.bridged', 'call.unbridged', 'call.hangup', 'call.dtmf',
                'channel.update', 'system.status',
              ],
            },
            data: {
              type: 'object',
              properties: {
                event: { type: 'string' },
                uuid: { type: 'string' },
                callerNumber: { type: 'string' },
                calleeNumber: { type: 'string' },
                domain: { type: 'string' },
                channelState: { type: 'string' },
                answerState: { type: 'string' },
                direction: { type: 'string' },
                hangupCause: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/api/auth/token': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange API key for a JWT token',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['api_key'], properties: { api_key: { type: 'string' }, domain: { type: 'string' } } } } },
        },
        responses: {
          200: { description: 'JWT issued', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, expires_in: { type: 'string' }, token_type: { type: 'string' } } } } } },
          401: { description: 'Invalid API key' },
        },
      },
    },
    '/api/auth/verify': {
      get: { tags: ['Auth'], summary: 'Verify credentials', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], responses: { 200: { description: 'Valid' }, 401: { description: 'Unauthorized' } } },
    },
    '/api/status': {
      get: { tags: ['Status'], summary: 'Health check (no auth required)', responses: { 200: { description: 'OK' } } },
    },
    '/api/status/detailed': {
      get: { tags: ['Status'], summary: 'Detailed status: ESL, DB, WebSocket', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], responses: { 200: { description: 'Service statuses' } } },
    },
    '/api/calls/active': {
      get: {
        tags: ['Calls'], summary: 'List all active (bridged) calls',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [{ in: 'query', name: 'domain', schema: { type: 'string' } }],
        responses: { 200: { description: 'Active calls', content: { 'application/json': { schema: { type: 'object', properties: { calls: { type: 'array', items: { $ref: '#/components/schemas/ActiveCall' } }, count: { type: 'integer' } } } } } } },
      },
    },
    '/api/calls/channels': {
      get: { tags: ['Calls'], summary: 'List all active channel legs', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'query', name: 'domain', schema: { type: 'string' } }], responses: { 200: { description: 'Channels' } } },
    },
    '/api/calls/channels/{uuid}': {
      get: { tags: ['Calls'], summary: 'Get channel by UUID', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Channel info' }, 404: { description: 'Not found' } } },
    },
    '/api/calls/esl/status': {
      get: { tags: ['Calls'], summary: 'ESL connection status', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], responses: { 200: { description: 'ESL status' } } },
    },
    '/api/calls/originate': {
      post: {
        tags: ['Calls'], summary: 'Originate (make) a new call',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OriginateRequest' } } } },
        responses: { 200: { description: 'Call originated' }, 400: { description: 'Validation error' }, 503: { description: 'ESL not connected' } },
      },
    },
    '/api/calls/{uuid}/hangup': {
      post: {
        tags: ['Calls'], summary: 'Hangup a call',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { cause: { type: 'string', default: 'NORMAL_CLEARING' } } } } } },
        responses: { 200: { description: 'Call terminated' }, 503: { description: 'ESL not connected' } },
      },
    },
    '/api/calls/{uuid}/hold': {
      post: { tags: ['Calls'], summary: 'Place call on hold', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'On hold' } } },
    },
    '/api/calls/{uuid}/unhold': {
      post: { tags: ['Calls'], summary: 'Remove call from hold', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Resumed' } } },
    },
    '/api/calls/{uuid}/hold/toggle': {
      post: { tags: ['Calls'], summary: 'Toggle hold state', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Toggled' } } },
    },
    '/api/calls/{uuid}/transfer': {
      post: {
        tags: ['Calls'], summary: 'Transfer a call (blind or attended)',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransferRequest' } } } },
        responses: { 200: { description: 'Transfer initiated' }, 400: { description: 'Validation error' } },
      },
    },
    '/api/calls/{uuid}/dtmf': {
      post: {
        tags: ['Calls'], summary: 'Send DTMF tones',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['digits'], properties: { digits: { type: 'string', example: '1234#' } } } } } },
        responses: { 200: { description: 'DTMF sent' } },
      },
    },
    '/api/calls/{uuid}/mute': {
      post: { tags: ['Calls'], summary: 'Mute channel', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Muted' } } },
    },
    '/api/calls/{uuid}/unmute': {
      post: { tags: ['Calls'], summary: 'Unmute channel', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Unmuted' } } },
    },
    '/api/cdr': {
      get: {
        tags: ['CDR'], summary: 'Get call detail records with filters',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'domain', schema: { type: 'string' } },
          { in: 'query', name: 'start_date', schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'end_date', schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'direction', schema: { type: 'string', enum: ['inbound', 'outbound', 'local'] } },
          { in: 'query', name: 'extension', schema: { type: 'string' } },
          { in: 'query', name: 'search', schema: { type: 'string' }, description: 'Search caller/callee number or name' },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 100, maximum: 1000 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'CDR records', content: { 'application/json': { schema: { type: 'object', properties: { records: { type: 'array', items: { $ref: '#/components/schemas/CDRRecord' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } } },
      },
    },
    '/api/cdr/stats/summary': {
      get: {
        tags: ['CDR'], summary: 'Call statistics summary',
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { in: 'query', name: 'domain', schema: { type: 'string' } },
          { in: 'query', name: 'start_date', schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'end_date', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Stats by direction' } },
      },
    },
    '/api/cdr/{uuid}': {
      get: { tags: ['CDR'], summary: 'Get CDR record by UUID', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'uuid', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 200: { description: 'Record' }, 404: { description: 'Not found' } } },
    },
    '/api/extensions': {
      get: { tags: ['Extensions'], summary: 'List extensions for a domain', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'query', name: 'domain', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Extension list' } } },
    },
    '/api/extensions/registrations': {
      get: { tags: ['Extensions'], summary: 'SIP registration status', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'query', name: 'domain', schema: { type: 'string' } }], responses: { 200: { description: 'Registrations' } } },
    },
    '/api/extensions/{extension}': {
      get: { tags: ['Extensions'], summary: 'Get extension by number', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], parameters: [{ in: 'path', name: 'extension', required: true, schema: { type: 'string' } }, { in: 'query', name: 'domain', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Extension' }, 404: { description: 'Not found' } } },
    },
    '/api/domains': {
      get: { tags: ['Domains'], summary: 'List all FusionPBX domains', security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }], responses: { 200: { description: 'Domains' } } },
    },
  },
};

module.exports = swaggerSpec;
