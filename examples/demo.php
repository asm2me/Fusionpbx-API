<?php
/**
 * FusionPBX API Bridge — Live Demo Page
 * Shows REST API calls + real-time WebSocket events in one page.
 *
 * Deploy anywhere that can reach your API server.
 * Set the two constants below before use.
 */

require_once __DIR__ . '/FusionPBXApiClient.php';

const API_URL    = 'http://localhost:3000';    // PHP server-side calls (direct, stays local)
const API_KEY    = 'your-api-key-here';        // Set in Admin → API Bridge
const WS_URL     = 'wss://mt.voipat.com';      // Browser WebSocket via Nginx (wss://)
const API_DOMAIN = '';                         // FusionPBX domain, or '' for all

// Browser JS uses Nginx reverse proxy path instead of direct port 3000
const BROWSER_API_BASE = '/pbxapi';           // https://mt.voipat.com/pbxapi/ → port 3000

$api = new FusionPBXApiClient(API_URL, API_KEY);

// ── REST calls (server-side) ──────────────────────────────────────────────────
$status      = $api->getDetailedStatus();
$activeCalls = $api->getActiveCalls(API_DOMAIN);
$extensions  = $api->getExtensions(API_DOMAIN);
$cdrStats    = $api->getCdrStats(array_filter(['domain' => API_DOMAIN]));
$recentCdr   = $api->getCdr(array_filter(['domain' => API_DOMAIN, 'limit' => 10]));
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FusionPBX API Bridge — Live Demo</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
<style>
    body { background: #f8f9fa; }
    .card { margin-bottom: 1.2rem; }
    #ws-log { height: 320px; overflow-y: auto; background: #1e1e1e; color: #d4d4d4;
               font-family: monospace; font-size: 0.82rem; padding: 10px; border-radius: 4px; }
    .ws-event { border-left: 3px solid #0d6efd; padding-left: 8px; margin-bottom: 6px; }
    .ws-event.answered  { border-color: #198754; }
    .ws-event.hangup    { border-color: #dc3545; }
    .ws-event.held      { border-color: #fd7e14; }
    .ws-event.created   { border-color: #0dcaf0; }
    .badge-esl   { background: #198754; }
    .badge-no-esl{ background: #dc3545; }
    pre { white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
<div class="container-fluid py-4">
<h2 class="mb-4">FusionPBX API Bridge <small class="text-muted fs-5">Live Demo</small></h2>

<!-- ── Status Row ──────────────────────────────────────────────────────────── -->
<div class="row">
    <div class="col-md-3">
        <div class="card">
            <div class="card-body text-center">
                <div class="fs-4 fw-bold"><?= $activeCalls['count'] ?? 0 ?></div>
                <div class="text-muted">Active Calls</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card">
            <div class="card-body text-center">
                <div class="fs-4 fw-bold"><?= $cdrStats['total'] ?? '—' ?></div>
                <div class="text-muted">Total CDR</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card">
            <div class="card-body text-center">
                <div class="fs-4 fw-bold"><?= $cdrStats['answered'] ?? '—' ?></div>
                <div class="text-muted">Answered</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card">
            <div class="card-body text-center">
                <?php
                $eslOk = ($status['esl']['connected'] ?? false);
                $dbOk  = ($status['db']['connected']  ?? false);
                ?>
                <span class="badge <?= $eslOk ? 'badge-esl' : 'badge-no-esl' ?> me-1">
                    ESL <?= $eslOk ? '✓' : '✗' ?>
                </span>
                <span class="badge <?= $dbOk ? 'bg-success' : 'bg-danger' ?>">
                    DB <?= $dbOk ? '✓' : '✗' ?>
                </span>
                <div class="text-muted mt-1 small">Service Status</div>
            </div>
        </div>
    </div>
</div>

<!-- ── Active Calls ────────────────────────────────────────────────────────── -->
<div class="card">
    <div class="card-header d-flex justify-content-between align-items-center">
        <strong>Active Calls</strong>
        <button class="btn btn-sm btn-outline-primary" onclick="refreshCalls()">Refresh</button>
    </div>
    <div class="card-body p-0">
        <div id="active-calls-table">
            <?php if (empty($activeCalls['calls'])): ?>
            <p class="text-muted p-3 mb-0">No active calls.</p>
            <?php else: ?>
            <table class="table table-sm table-hover mb-0">
                <thead class="table-light">
                    <tr>
                        <th>UUID</th><th>From</th><th>To</th><th>Direction</th>
                        <th>State</th><th>Duration</th><th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($activeCalls['calls'] as $call): ?>
                <tr>
                    <td><code><?= substr(htmlspecialchars($call['uuid']), 0, 8) ?>…</code></td>
                    <td><?= htmlspecialchars($call['cid_num'] ?? '') ?></td>
                    <td><?= htmlspecialchars($call['dest'] ?? '') ?></td>
                    <td><?= htmlspecialchars($call['direction'] ?? '') ?></td>
                    <td><span class="badge bg-success"><?= htmlspecialchars($call['callstate'] ?? '') ?></span></td>
                    <td><?php
                        $epoch = $call['created_epoch'] ?? 0;
                        echo $epoch ? gmdate('H:i:s', time() - $epoch) : '—';
                    ?></td>
                    <td>
                        <button class="btn btn-xs btn-warning btn-sm"
                            onclick="callAction('<?= $call['uuid'] ?>', 'hold')">Hold</button>
                        <button class="btn btn-xs btn-info btn-sm"
                            onclick="callAction('<?= $call['uuid'] ?>', 'unhold')">Unhold</button>
                        <button class="btn btn-xs btn-danger btn-sm"
                            onclick="callAction('<?= $call['uuid'] ?>', 'hangup')">Hangup</button>
                    </td>
                </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
        </div>
    </div>
</div>

<!-- ── Originate Call ──────────────────────────────────────────────────────── -->
<div class="card">
    <div class="card-header"><strong>Originate Call</strong></div>
    <div class="card-body">
        <div class="row g-2">
            <div class="col-md-2">
                <input type="text" id="orig-from" class="form-control" placeholder="From ext (e.g. 1001)">
            </div>
            <div class="col-md-2">
                <input type="text" id="orig-to" class="form-control" placeholder="To number">
            </div>
            <div class="col-md-3">
                <input type="text" id="orig-domain" class="form-control" placeholder="Domain (e.g. company.com)">
            </div>
            <div class="col-md-2">
                <input type="text" id="orig-callerid" class="form-control" placeholder="Caller ID">
            </div>
            <div class="col-md-1">
                <button class="btn btn-success w-100" onclick="originateCall()">Call</button>
            </div>
        </div>
        <div id="orig-result" class="mt-2"></div>
    </div>
</div>

<!-- ── Recent CDR ──────────────────────────────────────────────────────────── -->
<div class="card">
    <div class="card-header"><strong>Recent CDR (last 10)</strong></div>
    <div class="card-body p-0">
        <?php if (empty($recentCdr['records'])): ?>
        <p class="text-muted p-3 mb-0">No CDR records.</p>
        <?php else: ?>
        <table class="table table-sm table-hover mb-0">
            <thead class="table-light">
                <tr>
                    <th>Time</th><th>From</th><th>To</th><th>Direction</th>
                    <th>Duration</th><th>Status</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($recentCdr['records'] as $rec): ?>
            <tr>
                <td><?= htmlspecialchars(substr($rec['start_stamp'] ?? '', 0, 16)) ?></td>
                <td><?= htmlspecialchars($rec['caller_id_number'] ?? '') ?></td>
                <td><?= htmlspecialchars($rec['destination_number'] ?? '') ?></td>
                <td><?= htmlspecialchars($rec['direction'] ?? '') ?></td>
                <td><?= gmdate('H:i:s', (int)($rec['duration'] ?? 0)) ?></td>
                <td>
                    <?php $hc = $rec['hangup_cause'] ?? ''; ?>
                    <span class="badge <?= $hc === 'NORMAL_CLEARING' ? 'bg-success' : 'bg-secondary' ?>">
                        <?= htmlspecialchars($hc) ?>
                    </span>
                </td>
            </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <?php endif; ?>
    </div>
</div>

<!-- ── WebSocket Live Events ───────────────────────────────────────────────── -->
<div class="card">
    <div class="card-header d-flex justify-content-between align-items-center">
        <strong>Live Events <span id="ws-status" class="badge bg-secondary ms-2">Connecting…</span></strong>
        <button class="btn btn-sm btn-outline-secondary" onclick="clearLog()">Clear</button>
    </div>
    <div class="card-body p-0">
        <div id="ws-log"></div>
    </div>
</div>

</div><!-- /container -->

<!-- ── AJAX call control ───────────────────────────────────────────────────── -->
<script>
const API_BASE = '<?= BROWSER_API_BASE ?>';  // /pbxapi → Nginx → port 3000
const API_KEY  = '<?= API_KEY ?>';
const WS_URL   = '<?= WS_URL ?>';
const DOMAIN   = '<?= API_DOMAIN ?>';

// ── REST helpers ──────────────────────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, opts);
    return res.json();
}

async function callAction(uuid, action) {
    const path = `/api/calls/${uuid}/${action}`;
    const data = await apiFetch(path, 'POST');
    logEvent({ type: `action.${action}`, data: { uuid, result: data } });
}

async function originateCall() {
    const from     = document.getElementById('orig-from').value.trim();
    const to       = document.getElementById('orig-to').value.trim();
    const domain   = document.getElementById('orig-domain').value.trim();
    const callerId = document.getElementById('orig-callerid').value.trim();
    if (!from || !to || !domain) {
        alert('From, To, and Domain are required.');
        return;
    }
    const data = await apiFetch('/api/calls/originate', 'POST', { from, to, domain, callerId });
    const el = document.getElementById('orig-result');
    if (data.uuid) {
        el.innerHTML = `<div class="alert alert-success">Call initiated — UUID: <code>${data.uuid}</code></div>`;
    } else {
        el.innerHTML = `<div class="alert alert-danger">${data.detail || JSON.stringify(data)}</div>`;
    }
}

async function refreshCalls() {
    const q    = DOMAIN ? `?domain=${DOMAIN}` : '';
    const data = await apiFetch('/api/calls/active' + q);
    // Simple reload — in production you'd update the DOM
    location.reload();
}

function clearLog() {
    document.getElementById('ws-log').innerHTML = '';
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wsStatusEl = document.getElementById('ws-status');
const wsLogEl    = document.getElementById('ws-log');

function connectWebSocket() {
    const q  = DOMAIN ? `&domain=${DOMAIN}` : '';
    const ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(API_KEY)}${q}`);

    ws.onopen = () => {
        wsStatusEl.textContent  = 'Connected';
        wsStatusEl.className    = 'badge bg-success ms-2';
        logEvent({ type: 'system.connected', data: { message: 'WebSocket connected' } });
    };

    ws.onclose = () => {
        wsStatusEl.textContent = 'Disconnected — reconnecting…';
        wsStatusEl.className   = 'badge bg-danger ms-2';
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        wsStatusEl.textContent = 'Error';
        wsStatusEl.className   = 'badge bg-danger ms-2';
    };

    ws.onmessage = (e) => {
        try {
            const event = JSON.parse(e.data);
            logEvent(event);

            // Auto-refresh active calls table on call state changes
            if (['call.created','call.hangup','call.answered'].includes(event.type)) {
                setTimeout(refreshCalls, 500);
            }
        } catch {
            logRaw(e.data);
        }
    };
}

function logEvent(event) {
    const type      = event.type || 'unknown';
    const ts        = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const data      = event.data || {};
    const cssClass  = type.includes('answered') ? 'answered'
                    : type.includes('hangup')   ? 'hangup'
                    : type.includes('held')     ? 'held'
                    : type.includes('created')  ? 'created' : '';

    const from = data.callerNumber || data.cid_num || '';
    const to   = data.calleeNumber || data.dest    || '';
    const uuid = data.uuid ? data.uuid.substring(0, 8) + '…' : '';

    const summary = from ? `${from} → ${to}` : (data.message || '');

    wsLogEl.innerHTML = `
        <div class="ws-event ${cssClass}">
            <span class="text-secondary">${ts}</span>
            <span class="text-warning ms-2">${type}</span>
            ${uuid ? `<span class="text-muted ms-2">[${uuid}]</span>` : ''}
            ${summary ? `<span class="text-light ms-2">${summary}</span>` : ''}
            <details class="mt-1">
                <summary class="text-muted" style="cursor:pointer;font-size:0.8em">raw</summary>
                <pre class="text-secondary mt-1" style="font-size:0.78em">${JSON.stringify(event, null, 2)}</pre>
            </details>
        </div>` + wsLogEl.innerHTML;
}

function logRaw(msg) {
    wsLogEl.innerHTML = `<div class="ws-event"><span class="text-muted">${new Date().toLocaleTimeString()}</span> <span class="text-light">${msg}</span></div>` + wsLogEl.innerHTML;
}

connectWebSocket();
</script>
</body>
</html>
