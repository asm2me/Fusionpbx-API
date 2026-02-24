# FusionPBX API Bridge

A production-ready REST API + WebSocket bridge that connects your CRM to FusionPBX/FreeSWITCH for complete telephony integration.

## Features

| Feature | Description |
|---|---|
| **Originate calls** | CRM triggers outbound call from any extension |
| **Hangup** | End any active call by UUID |
| **Hold / Unhold** | Place call on hold or resume |
| **Transfer** | Blind or attended (warm) transfer |
| **Mute / Unmute** | Mute audio on a channel |
| **DTMF** | Send keypad tones |
| **Active calls** | Real-time list of bridged calls and channels |
| **CDR** | Query call history with filters (date, direction, extension, search) |
| **Call stats** | Summary stats (total, answered, missed, avg duration) |
| **Extensions** | Directory and registration status |
| **WebSocket** | Real-time push events to CRM (call.created, call.answered, call.hangup, …) |
| **Swagger UI** | Interactive API documentation at `/api-docs` |

---

## Architecture

```
CRM
 │
 ├─ REST API (HTTP)  ──►  FusionPBX API Bridge  ──►  FreeSWITCH ESL (port 8021)
 └─ WebSocket (WS)   ◄──  FusionPBX API Bridge  ◄──  FreeSWITCH Events
                                     │
                                     └──►  FusionPBX PostgreSQL DB (CDR/Extensions)
```

## Prerequisites

- Node.js 18+
- FusionPBX server with:
  - Event Socket (ESL) enabled on port 8021
  - PostgreSQL accessible from this server
  - (Optional) FusionPBX REST API enabled

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd fusionpbx-api
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your FusionPBX details:

```env
# Your FusionPBX server
FUSIONPBX_HOST=pbx.company.com
FUSIONPBX_DOMAIN=company.com

# FreeSWITCH ESL (usually same host, port 8021)
ESL_HOST=pbx.company.com
ESL_PORT=8021
ESL_PASSWORD=ClueCon        # change this in /etc/freeswitch/autoload_configs/event_socket.conf.xml

# PostgreSQL (FusionPBX database)
DB_HOST=pbx.company.com
DB_NAME=fusionpbx
DB_USER=fusionpbx
DB_PASSWORD=your-db-password

# CRM integration secret
API_KEY=your-secret-crm-api-key
JWT_SECRET=your-long-random-jwt-secret
```

### 3. Start

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Open **http://localhost:3000/api-docs** to see the interactive Swagger UI.

---

## FusionPBX Server Setup

### Enable ESL (Event Socket)

SSH into your FusionPBX server:

```bash
nano /etc/freeswitch/autoload_configs/event_socket.conf.xml
```

Make sure it looks like:

```xml
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="0.0.0.0"/>   <!-- or restrict to API server IP -->
    <param name="listen-port" value="8021"/>
    <param name="password" value="YourStrongPassword"/>
    <param name="apply-inbound-acl" value="loopback.auto"/>
  </settings>
</configuration>
```

Reload: `fs_cli -x "reload mod_event_socket"`

### Firewall

Allow port 8021 (ESL) and 5432 (PostgreSQL) only from your API server:

```bash
ufw allow from <api-server-ip> to any port 8021
ufw allow from <api-server-ip> to any port 5432
```

---

## API Reference

### Authentication

**Option A – API Key** (server-to-server, recommended):

```http
GET /api/calls/active
X-API-Key: your-secret-crm-api-key
```

**Option B – JWT Bearer Token**:

```bash
# Exchange API key for JWT
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key": "your-secret-crm-api-key", "domain": "company.com"}'

# Use returned token
curl http://localhost:3000/api/calls/active \
  -H "Authorization: Bearer eyJ..."
```

---

### Call Operations

#### Make a Call

```bash
POST /api/calls/originate
{
  "from": "1001",          # Extension that will ring first (agent's phone)
  "to": "1002",            # Destination (extension or PSTN number)
  "domain": "company.com",
  "callerId": "5551234567",   # optional
  "callerName": "Support",    # optional
  "timeout": 30               # ring timeout in seconds
}
```

Response:
```json
{ "uuid": "abc123-...", "message": "Call from 1001 to 1002 initiated" }
```

#### Hangup

```bash
POST /api/calls/{uuid}/hangup
{ "cause": "NORMAL_CLEARING" }
```

#### Hold / Unhold

```bash
POST /api/calls/{uuid}/hold
POST /api/calls/{uuid}/unhold
POST /api/calls/{uuid}/hold/toggle
```

#### Transfer

```bash
POST /api/calls/{uuid}/transfer
{
  "destination": "1005",
  "domain": "company.com",
  "type": "blind"         # "blind" | "attended"
}
```

#### DTMF

```bash
POST /api/calls/{uuid}/dtmf
{ "digits": "1234#" }
```

#### Active Calls

```bash
GET /api/calls/active?domain=company.com
GET /api/calls/channels?domain=company.com
GET /api/calls/channels/{uuid}
```

---

### CDR (Call History)

```bash
GET /api/cdr?domain=company.com&start_date=2024-01-01&end_date=2024-01-31
GET /api/cdr?domain=company.com&direction=inbound&search=0555
GET /api/cdr?domain=company.com&extension=1001&limit=50&offset=0
GET /api/cdr/{uuid}
GET /api/cdr/stats/summary?domain=company.com&start_date=2024-01-01
```

---

### WebSocket – Real-Time Events

Connect from CRM:

```javascript
// Option A: API key
const ws = new WebSocket('ws://localhost:3000/ws?token=your-api-key&domain=company.com');

// Option B: JWT
const ws = new WebSocket('ws://localhost:3000/ws?token=eyJ...&domain=company.com');

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log(msg.type, msg.data);
};
```

#### Event Types

| Type | Description |
|---|---|
| `call.created` | New call leg started |
| `call.answered` | Call was answered |
| `call.held` | Call placed on hold |
| `call.unheld` | Call removed from hold |
| `call.bridged` | Two legs connected |
| `call.unbridged` | Call legs separated |
| `call.hangup` | Call ended |
| `call.dtmf` | DTMF digit pressed |
| `channel.update` | Generic channel state change |
| `system.status` | ESL connected/disconnected |

#### Event Payload

```json
{
  "type": "call.answered",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "event": "CHANNEL_ANSWER",
    "uuid": "abc123-def456-...",
    "callerNumber": "1001",
    "calleeNumber": "1002",
    "domain": "company.com",
    "channelState": "CS_EXECUTE",
    "answerState": "answered",
    "direction": "outbound"
  }
}
```

---

## Deployment

### PM2 (recommended)

```bash
npm install -g pm2
pm2 start server.js --name fusionpbx-api --instances 1
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name pbx-api.company.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # required for WebSocket
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Project Structure

```
fusionpbx-api/
├── server.js                  # Entry point
├── src/
│   ├── app.js                 # Express app setup
│   ├── config/
│   │   └── config.js          # Central configuration
│   ├── middleware/
│   │   ├── auth.js            # API key + JWT auth
│   │   ├── errorHandler.js    # Global error handler
│   │   └── validate.js        # express-validator helper
│   ├── routes/
│   │   ├── auth.js            # POST /api/auth/token
│   │   ├── calls.js           # Call control endpoints
│   │   ├── cdr.js             # CDR history endpoints
│   │   ├── extensions.js      # Extensions directory
│   │   ├── domains.js         # Domains list
│   │   └── status.js          # Health check
│   ├── services/
│   │   ├── eslService.js      # FreeSWITCH ESL (call control + events)
│   │   ├── fusionpbxService.js # FusionPBX HTTP API
│   │   ├── dbService.js       # PostgreSQL CDR queries
│   │   └── wsService.js       # WebSocket push to CRM
│   ├── swagger/
│   │   └── swagger.js         # OpenAPI 3.0 spec
│   └── utils/
│       └── logger.js          # Winston logger
├── .env.example
└── package.json
```
