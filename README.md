# FusionPBX API Bridge

A production-ready REST API + WebSocket daemon that connects your CRM to FusionPBX/FreeSWITCH for complete telephony integration. Built in **Python (FastAPI + asyncio)** with settings managed entirely from the **FusionPBX Admin UI** — no manual config files needed after install.

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
| **WebSocket** | Real-time push events to CRM (`call.created`, `call.answered`, `call.hangup`, …) |
| **FusionPBX module** | Settings managed from **Admin → API Bridge** |
| **Interactive docs** | Auto-generated API docs at `/docs` |

---

## Architecture

```
FusionPBX Admin UI
 │  (Admin → API Bridge)
 │  Saves settings to v_default_settings
 │
 ▼
FusionPBX PostgreSQL ◄────────────────────────────┐
 │  (CDR / Extensions / Settings)                  │
 │                                                  │
 ▼                                                  │
Python Daemon (FastAPI + asyncio)  ────►  FreeSWITCH ESL :8021
 │  Reads settings at startup                       │
 │  Reads CDR / Extensions from DB      Sends commands (originate, hold…)
 │                                      Receives events (CHANNEL_ANSWER…)
 ├─ REST API (HTTP)   ◄──  CRM
 └─ WebSocket (WS)    ──►  CRM  (real-time call events)
```

### Configuration flow

```
/etc/fusionpbx/config.conf  ──►  DB credentials only (auto-detected)
v_default_settings          ──►  All other settings (ESL, API key, ports…)
                                 Editable live from FusionPBX Admin → API Bridge
```

---

## Prerequisites

- FusionPBX server (Debian / Ubuntu) with:
  - FreeSWITCH ESL enabled on port 8021
  - PostgreSQL accessible locally
- Python 3.10+ installed on the same server

---

## Installation

Run once on the FusionPBX server as root:

```bash
git clone <repo>
cd fusionpbx-api
sudo bash fusionpbx_app/install/install.sh
```

The script will:

1. Install Python dependencies system-wide via `pip3`
2. Copy the Python service to `/var/lib/fusionpbx-api-bridge`
3. Auto-detect DB credentials from `/etc/fusionpbx/config.conf` and write a minimal `.env`
4. Copy the PHP module to `/var/www/fusionpbx/app/api_bridge/`
5. Insert default settings, permissions, and the **Admin → API Bridge** menu item directly into the FusionPBX PostgreSQL database
6. Write a `sudoers` snippet so the web process can control the daemon
7. Install, enable, and start the `fusionpbx-api-bridge` systemd service

After the script completes, navigate to **Admin → API Bridge** in FusionPBX to configure your settings.

> If the menu item doesn't appear immediately, log out and back in to refresh the session.

---

## FusionPBX Server Setup

### Enable ESL (Event Socket)

```bash
nano /etc/freeswitch/autoload_configs/event_socket.conf.xml
```

```xml
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="YourStrongPassword"/>
    <param name="apply-inbound-acl" value="loopback.auto"/>
  </settings>
</configuration>
```

```bash
fs_cli -x "reload mod_event_socket"
```

### Firewall (if daemon runs on a separate host)

```bash
ufw allow from <api-server-ip> to any port 8021
ufw allow from <api-server-ip> to any port 5432
```

---

## Development / Manual Setup

For development without a live FusionPBX server:

```bash
cd python
pip3 install -r requirements.txt --break-system-packages
cp .env.example .env   # edit DB credentials, uncomment optional overrides
python3 main.py
```

The `.env` file normally only needs DB credentials — all other settings load from `v_default_settings` at startup. Uncomment the optional lines in `.env.example` to override without a database.

---

## API Reference

All endpoints except `GET /api/status` require authentication.

### Authentication

**Option A — API Key** (recommended for server-to-server):

```http
GET /api/calls/active
X-API-Key: your-api-key
```

**Option B — JWT Bearer Token**:

```bash
# Exchange API key for a JWT
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"api_key": "your-api-key", "domain": "company.com"}'

# Use the returned token
curl http://localhost:3000/api/calls/active \
  -H "Authorization: Bearer eyJ..."
```

---

### Call Operations

#### Originate a call

```http
POST /api/calls/originate
Content-Type: application/json

{
  "from": "1001",
  "to": "1002",
  "domain": "company.com",
  "callerId": "5551234567",
  "callerName": "Support",
  "timeout": 30
}
```

```json
{ "uuid": "abc123-...", "message": "Call from 1001 to 1002 initiated" }
```

#### Hangup

```http
POST /api/calls/{uuid}/hangup
{ "cause": "NORMAL_CLEARING" }
```

#### Hold / Unhold / Toggle

```http
POST /api/calls/{uuid}/hold
POST /api/calls/{uuid}/unhold
POST /api/calls/{uuid}/hold/toggle
```

#### Transfer

```http
POST /api/calls/{uuid}/transfer
{
  "destination": "1005",
  "domain": "company.com",
  "type": "blind"
}
```

`type` is `"blind"` (default) or `"attended"`.

#### DTMF

```http
POST /api/calls/{uuid}/dtmf
{ "digits": "1234#" }
```

#### Mute / Unmute

```http
POST /api/calls/{uuid}/mute
POST /api/calls/{uuid}/unmute
```

#### Active calls & channels

```http
GET /api/calls/active?domain=company.com
GET /api/calls/channels?domain=company.com
GET /api/calls/channels/{uuid}
GET /api/calls/esl/status
```

---

### CDR (Call History)

```http
GET /api/cdr?domain=company.com&start_date=2024-01-01&end_date=2024-01-31
GET /api/cdr?domain=company.com&direction=inbound&search=0555
GET /api/cdr?domain=company.com&extension=1001&limit=50&offset=0
GET /api/cdr/{uuid}
GET /api/cdr/stats/summary?domain=company.com&start_date=2024-01-01
```

| Parameter | Description |
|---|---|
| `domain` | Filter by FusionPBX domain |
| `start_date` / `end_date` | ISO 8601 date-time range |
| `direction` | `inbound` \| `outbound` \| `local` |
| `extension` | Filter by caller or callee extension |
| `search` | Search caller/callee number or name |
| `limit` | Records per page (default `100`, max `1000`) |
| `offset` | Pagination offset |

---

### Extensions & Domains

```http
GET /api/extensions?domain=company.com
GET /api/extensions/{extension}?domain=company.com
GET /api/extensions/registrations?domain=company.com
GET /api/domains
```

---

### Status

```http
GET /api/status            # public health check
GET /api/status/detailed   # ESL + DB + WS client counts (auth required)
```

---

### WebSocket — Real-Time Events

Connect from your CRM:

```javascript
// API key auth
const ws = new WebSocket('ws://localhost:3000/ws?token=your-api-key&domain=company.com');

// JWT auth
const ws = new WebSocket('ws://localhost:3000/ws?token=eyJ...&domain=company.com');

ws.onmessage = (e) => {
  const { type, timestamp, data } = JSON.parse(e.data);
  console.log(type, data);
};
```

The `domain` parameter is optional — omit it to receive events for all domains.

#### Event types

| Type | Trigger |
|---|---|
| `call.created` | New channel (CHANNEL_CREATE) |
| `call.answered` | Call answered (CHANNEL_ANSWER) |
| `call.held` | Call placed on hold |
| `call.unheld` | Call removed from hold |
| `call.bridged` | Two legs connected |
| `call.unbridged` | Legs separated |
| `call.hangup` | Call ended |
| `call.dtmf` | DTMF digit received |
| `channel.update` | Generic state change |
| `system.status` | ESL connected / disconnected |

#### Event payload

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

### systemd service (installed automatically)

```bash
systemctl status  fusionpbx-api-bridge
systemctl restart fusionpbx-api-bridge
journalctl -u fusionpbx-api-bridge -f
```

### Nginx Reverse Proxy (optional)

```nginx
server {
    listen 443 ssl;
    server_name pbx-api.company.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
    }
}
```

### Docker

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY python/ .
EXPOSE 3000
CMD ["python3", "main.py"]
```

```bash
docker build -t fusionpbx-api-bridge .
docker run -d \
  -p 3000:3000 \
  -e DB_HOST=your-db-host \
  -e DB_PASSWORD=your-db-password \
  --name fusionpbx-api-bridge \
  fusionpbx-api-bridge
```

---

## Project Structure

```
fusionpbx-api/
│
├── fusionpbx_app/                       # FusionPBX PHP module
│   ├── app_config.php                   # App registration metadata
│   ├── index.php                        # Admin UI — settings form + daemon status
│   ├── save.php                         # Saves settings to v_default_settings
│   ├── daemon.php                       # Start / stop / restart daemon via systemctl
│   └── install/
│       ├── install.sh                   # One-command server installer
│       └── fusionpbx-api-bridge.service # systemd unit file
│
├── python/                              # Python daemon (FastAPI + asyncio)
│   ├── main.py                          # Entry point — loads DB settings, starts services
│   ├── config.py                        # Auto-reads config.conf + v_default_settings
│   ├── requirements.txt
│   ├── .env.example                     # DB bootstrap only
│   ├── deps/
│   │   └── auth.py                      # API key + JWT FastAPI dependency
│   ├── routers/
│   │   ├── auth.py                      # POST /api/auth/token
│   │   ├── calls.py                     # Call control endpoints
│   │   ├── cdr.py                       # CDR history endpoints
│   │   ├── extensions.py                # Extensions directory
│   │   ├── domains.py                   # Domains list
│   │   └── status.py                    # Health check
│   └── services/
│       ├── esl_service.py               # FreeSWITCH ESL asyncio TCP client
│       ├── db_service.py                # PostgreSQL via asyncpg
│       ├── fusionpbx_service.py         # FusionPBX HTTP API client
│       └── ws_service.py               # WebSocket broadcast to CRM clients
│
└── migrations/
    └── 001_create_api_keys.sql          # Optional: per-user API key table
```

---

## Settings Reference

All settings are stored in `v_default_settings` (category `api_bridge`) and editable from **Admin → API Bridge** in FusionPBX. Click **Save & Restart** after any change to apply immediately.

| Setting | Default | Description |
|---|---|---|
| `esl_host` | `127.0.0.1` | FreeSWITCH ESL host |
| `esl_port` | `8021` | FreeSWITCH ESL port |
| `esl_password` | `ClueCon` | ESL password (from `event_socket.conf.xml`) |
| `esl_reconnect_delay` | `5` | Seconds between ESL reconnect attempts |
| `esl_max_reconnect` | `10` | Max ESL reconnect attempts before giving up |
| `api_port` | `3000` | Port the daemon listens on |
| `api_key` | _(empty)_ | Shared secret for CRM (`X-API-Key` header) |
| `jwt_secret` | _(empty)_ | JWT signing secret (min 32 chars) |
| `jwt_expire_hours` | `24` | JWT token validity in hours |
| `service_name` | `fusionpbx-api-bridge` | systemd unit name |
| `service_path` | `/var/lib/fusionpbx-api-bridge` | Path to the Python service directory |
