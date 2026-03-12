<?php
/*
 * FusionPBX API Bridge — Settings & Status Page
 * Place this directory at:  /var/www/fusionpbx/app/api_bridge/
 */

// ── Bootstrap ─────────────────────────────────────────────────────────────────
require_once dirname(__DIR__, 2) . "/resources/require.php";

if (!permission_exists('api_bridge_view')) {
    echo "<div class='container-fluid mt-4'><div class='alert alert-danger'>Access denied.</div></div>";
    require_once dirname(__DIR__, 2) . "/resources/footer.php";
    exit;
}

// ── Load all api_bridge settings from v_default_settings ─────────────────────
$sql = "SELECT default_setting_subcategory, default_setting_value, default_setting_description
        FROM v_default_settings
        WHERE default_setting_category = 'api_bridge'
          AND default_setting_enabled  = 'true'
        ORDER BY default_setting_subcategory";
$stmt = $db->prepare($sql);
$stmt->execute();
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$cfg = [];
$desc = [];
foreach ($rows as $row) {
    $cfg[$row['default_setting_subcategory']]  = $row['default_setting_value'];
    $desc[$row['default_setting_subcategory']] = $row['default_setting_description'];
}

// ── Get daemon status ─────────────────────────────────────────────────────────
$service = $cfg['service_name'] ?? 'fusionpbx-api-bridge';
$daemon_status  = 'unknown';
$daemon_active  = false;
$daemon_uptime  = '';

exec("systemctl is-active " . escapeshellarg($service) . " 2>&1", $out, $rc);
$daemon_active = ($rc === 0);
$daemon_status = $daemon_active ? 'running' : 'stopped';

if ($daemon_active) {
    exec("systemctl show " . escapeshellarg($service) . " --property=ActiveEnterTimestamp 2>&1", $ts_out);
    if (!empty($ts_out[0])) {
        $ts_str = trim(str_replace('ActiveEnterTimestamp=', '', $ts_out[0]));
        if ($ts_str) {
            $ts = strtotime($ts_str);
            $diff = time() - $ts;
            $h = floor($diff / 3600);
            $m = floor(($diff % 3600) / 60);
            $daemon_uptime = "Up {$h}h {$m}m";
        }
    }
}

// ── Page messages ─────────────────────────────────────────────────────────────
$message = '';
$message_type = 'success';
if (isset($_SESSION['api_bridge_message'])) {
    $message = $_SESSION['api_bridge_message'];
    $message_type = $_SESSION['api_bridge_message_type'] ?? 'success';
    unset($_SESSION['api_bridge_message'], $_SESSION['api_bridge_message_type']);
}

// ── Page header ───────────────────────────────────────────────────────────────
require_once dirname(__DIR__, 2) . "/resources/header.php";

?>

<div class="container-fluid">

    <!-- Page Title -->
    <div class="row">
        <div class="col-12">
            <div class="page-title-box d-flex align-items-center justify-content-between">
                <h4 class="mb-0">
                    <i class="fas fa-plug mr-2"></i>API Bridge
                    <small class="text-muted ml-2" style="font-size:0.6em;">FreeSWITCH ↔ CRM</small>
                </h4>
            </div>
        </div>
    </div>

    <?php if ($message): ?>
    <div class="alert alert-<?= htmlspecialchars($message_type) ?> alert-dismissible fade show" role="alert">
        <?= htmlspecialchars($message) ?>
        <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
    </div>
    <?php endif; ?>

    <!-- ── Status Card ──────────────────────────────────────────────────── -->
    <div class="row mb-4">
        <div class="col-md-6">
            <div class="card">
                <div class="card-header d-flex align-items-center justify-content-between">
                    <span><i class="fas fa-heartbeat mr-2"></i>Daemon Status</span>
                    <span class="badge badge-<?= $daemon_active ? 'success' : 'danger' ?> badge-pill" style="font-size:0.9em;">
                        <?= $daemon_active ? '● Running' : '○ Stopped' ?>
                    </span>
                </div>
                <div class="card-body">
                    <div class="d-flex align-items-center mb-3">
                        <div class="mr-4">
                            <div class="text-muted small">Service</div>
                            <strong><?= htmlspecialchars($service) ?></strong>
                        </div>
                        <?php if ($daemon_uptime): ?>
                        <div class="mr-4">
                            <div class="text-muted small">Uptime</div>
                            <strong><?= htmlspecialchars($daemon_uptime) ?></strong>
                        </div>
                        <?php endif; ?>
                        <div>
                            <div class="text-muted small">Port</div>
                            <strong><?= htmlspecialchars($cfg['api_port'] ?? '3000') ?></strong>
                        </div>
                    </div>

                    <?php if (permission_exists('api_bridge_edit')): ?>
                    <form method="POST" action="daemon.php" class="d-inline">
                        <input type="hidden" name="csrf_token" value="<?= $_SESSION['token'] ?? '' ?>">

                        <?php if (!$daemon_active): ?>
                        <button type="submit" name="action" value="start"
                                class="btn btn-success btn-sm mr-1">
                            <i class="fas fa-play mr-1"></i>Start
                        </button>
                        <?php else: ?>
                        <button type="submit" name="action" value="restart"
                                class="btn btn-warning btn-sm mr-1"
                                onclick="return confirm('Restart the API Bridge? Active connections will drop briefly.')">
                            <i class="fas fa-sync mr-1"></i>Restart
                        </button>
                        <button type="submit" name="action" value="stop"
                                class="btn btn-danger btn-sm mr-1"
                                onclick="return confirm('Stop the API Bridge?')">
                            <i class="fas fa-stop mr-1"></i>Stop
                        </button>
                        <?php endif; ?>

                        <button type="submit" name="action" value="enable"
                                class="btn btn-outline-secondary btn-sm mr-1"
                                title="Enable auto-start on boot">
                            <i class="fas fa-toggle-on mr-1"></i>Enable on boot
                        </button>
                    </form>
                    <?php endif; ?>

                    <a href="index.php" class="btn btn-outline-info btn-sm">
                        <i class="fas fa-sync-alt mr-1"></i>Refresh
                    </a>
                </div>
            </div>
        </div>

        <!-- Quick-connect info -->
        <div class="col-md-6">
            <div class="card">
                <div class="card-header"><i class="fas fa-info-circle mr-2"></i>Endpoints</div>
                <div class="card-body p-0">
                    <table class="table table-sm mb-0">
                        <tr>
                            <td class="text-muted pl-3">REST API</td>
                            <td><code>http://127.0.0.1:<?= htmlspecialchars($cfg['api_port'] ?? '3000') ?>/api</code></td>
                        </tr>
                        <tr>
                            <td class="text-muted pl-3">WebSocket</td>
                            <td><code>ws://127.0.0.1:<?= htmlspecialchars($cfg['api_port'] ?? '3000') ?>/ws</code></td>
                        </tr>
                        <tr>
                            <td class="text-muted pl-3">Health</td>
                            <td><code>http://127.0.0.1:<?= htmlspecialchars($cfg['api_port'] ?? '3000') ?>/api/status</code></td>
                        </tr>
                        <tr>
                            <td class="text-muted pl-3">Docs</td>
                            <td><code>http://127.0.0.1:<?= htmlspecialchars($cfg['api_port'] ?? '3000') ?>/docs</code></td>
                        </tr>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <!-- ── Settings Form ────────────────────────────────────────────────── -->
    <?php if (permission_exists('api_bridge_edit')): ?>
    <form method="POST" action="save.php">
        <input type="hidden" name="csrf_token" value="<?= $_SESSION['token'] ?? '' ?>">
    <?php endif; ?>

        <!-- FreeSWITCH ESL -->
        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-network-wired mr-2"></i>FreeSWITCH ESL Connection</div>
            <div class="card-body">
                <div class="form-row">
                    <div class="form-group col-md-5">
                        <label>ESL Host</label>
                        <input type="text" name="esl_host" class="form-control"
                               value="<?= htmlspecialchars($cfg['esl_host'] ?? '127.0.0.1') ?>"
                               placeholder="127.0.0.1"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['esl_host'] ?? '') ?></small>
                    </div>
                    <div class="form-group col-md-2">
                        <label>ESL Port</label>
                        <input type="number" name="esl_port" class="form-control"
                               value="<?= htmlspecialchars($cfg['esl_port'] ?? '8021') ?>"
                               min="1" max="65535"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                    </div>
                    <div class="form-group col-md-5">
                        <label>ESL Password</label>
                        <div class="input-group">
                            <input type="password" name="esl_password" id="esl_password"
                                   class="form-control"
                                   value="<?= htmlspecialchars($cfg['esl_password'] ?? '') ?>"
                                   autocomplete="new-password"
                                   <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                            <div class="input-group-append">
                                <button type="button" class="btn btn-outline-secondary"
                                        onclick="toggleVisibility('esl_password', this)">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['esl_password'] ?? '') ?></small>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group col-md-3">
                        <label>Reconnect Delay (sec)</label>
                        <input type="number" name="esl_reconnect_delay" class="form-control"
                               value="<?= htmlspecialchars($cfg['esl_reconnect_delay'] ?? '5') ?>"
                               min="1" max="60"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                    </div>
                    <div class="form-group col-md-3">
                        <label>Max Reconnect Attempts</label>
                        <input type="number" name="esl_max_reconnect" class="form-control"
                               value="<?= htmlspecialchars($cfg['esl_max_reconnect'] ?? '10') ?>"
                               min="1" max="100"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                    </div>
                </div>
            </div>
        </div>

        <!-- API Server -->
        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-server mr-2"></i>API Server</div>
            <div class="card-body">
                <div class="form-row">
                    <div class="form-group col-md-2">
                        <label>Listen Port</label>
                        <input type="number" name="api_port" class="form-control"
                               value="<?= htmlspecialchars($cfg['api_port'] ?? '3000') ?>"
                               min="1024" max="65535"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['api_port'] ?? '') ?></small>
                    </div>
                    <div class="form-group col-md-5">
                        <label>API Key <span class="text-danger">*</span></label>
                        <div class="input-group">
                            <input type="password" name="api_key" id="api_key"
                                   class="form-control"
                                   value="<?= htmlspecialchars($cfg['api_key'] ?? '') ?>"
                                   autocomplete="new-password"
                                   placeholder="Strong random string"
                                   <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                            <div class="input-group-append">
                                <button type="button" class="btn btn-outline-secondary"
                                        onclick="toggleVisibility('api_key', this)">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <?php if (permission_exists('api_bridge_edit')): ?>
                                <button type="button" class="btn btn-outline-secondary"
                                        onclick="generateSecret('api_key')">
                                    <i class="fas fa-random"></i>
                                </button>
                                <?php endif; ?>
                            </div>
                        </div>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['api_key'] ?? '') ?></small>
                    </div>
                    <div class="form-group col-md-3">
                        <label>JWT Expire (hours)</label>
                        <input type="number" name="jwt_expire_hours" class="form-control"
                               value="<?= htmlspecialchars($cfg['jwt_expire_hours'] ?? '24') ?>"
                               min="1" max="8760"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group col-md-10">
                        <label>JWT Secret <span class="text-danger">*</span></label>
                        <div class="input-group">
                            <input type="password" name="jwt_secret" id="jwt_secret"
                                   class="form-control"
                                   value="<?= htmlspecialchars($cfg['jwt_secret'] ?? '') ?>"
                                   autocomplete="new-password"
                                   placeholder="Minimum 32 characters"
                                   <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                            <div class="input-group-append">
                                <button type="button" class="btn btn-outline-secondary"
                                        onclick="toggleVisibility('jwt_secret', this)">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <?php if (permission_exists('api_bridge_edit')): ?>
                                <button type="button" class="btn btn-outline-secondary"
                                        onclick="generateSecret('jwt_secret')">
                                    <i class="fas fa-random"></i>
                                </button>
                                <?php endif; ?>
                            </div>
                        </div>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['jwt_secret'] ?? '') ?></small>
                    </div>
                </div>
            </div>
        </div>

        <!-- Service / Paths -->
        <div class="card mb-3">
            <div class="card-header"><i class="fas fa-cog mr-2"></i>Service</div>
            <div class="card-body">
                <div class="form-row">
                    <div class="form-group col-md-4">
                        <label>systemd Service Name</label>
                        <input type="text" name="service_name" class="form-control"
                               value="<?= htmlspecialchars($cfg['service_name'] ?? 'fusionpbx-api-bridge') ?>"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['service_name'] ?? '') ?></small>
                    </div>
                    <div class="form-group col-md-8">
                        <label>Service Path</label>
                        <input type="text" name="service_path" class="form-control"
                               value="<?= htmlspecialchars($cfg['service_path'] ?? '/var/lib/fusionpbx-api-bridge') ?>"
                               <?= !permission_exists('api_bridge_edit') ? 'readonly' : '' ?>>
                        <small class="form-text text-muted"><?= htmlspecialchars($desc['service_path'] ?? '') ?></small>
                    </div>
                </div>

                <!-- Install hints -->
                <div class="alert alert-info mt-2 mb-0 small">
                    <strong><i class="fas fa-info-circle mr-1"></i>Setup reminder:</strong>
                    For daemon controls to work, run once on the server:
                    <pre class="mb-0 mt-1 bg-dark text-light p-2 rounded" style="font-size:0.85em;">echo "www-data ALL=(ALL) NOPASSWD: /bin/systemctl start <?= htmlspecialchars($service) ?>
www-data ALL=(ALL) NOPASSWD: /bin/systemctl stop <?= htmlspecialchars($service) ?>
www-data ALL=(ALL) NOPASSWD: /bin/systemctl restart <?= htmlspecialchars($service) ?>
www-data ALL=(ALL) NOPASSWD: /bin/systemctl enable <?= htmlspecialchars($service) ?>
www-data ALL=(ALL) NOPASSWD: /bin/systemctl show <?= htmlspecialchars($service) ?>" \
  | sudo tee /etc/sudoers.d/fusionpbx-api-bridge</pre>
                </div>
            </div>
        </div>

        <?php if (permission_exists('api_bridge_edit')): ?>
        <div class="mb-4">
            <button type="submit" class="btn btn-primary mr-2">
                <i class="fas fa-save mr-1"></i>Save Settings
            </button>
            <button type="submit" name="save_and_restart" value="1" class="btn btn-warning"
                    onclick="return confirm('Save settings and restart the API Bridge?')">
                <i class="fas fa-save mr-1"></i>Save &amp; Restart
            </button>
        </div>
        <?php endif; ?>

    <?php if (permission_exists('api_bridge_edit')): ?>
    </form>
    <?php endif; ?>

</div><!-- /container-fluid -->

<script>
function toggleVisibility(id, btn) {
    var el = document.getElementById(id);
    if (el.type === 'password') {
        el.type = 'text';
        btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
        el.type = 'password';
        btn.innerHTML = '<i class="fas fa-eye"></i>';
    }
}

function generateSecret(id) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    var arr   = new Uint8Array(48);
    window.crypto.getRandomValues(arr);
    var secret = '';
    for (var i = 0; i < 48; i++) {
        secret += chars[arr[i] % chars.length];
    }
    var el = document.getElementById(id);
    el.value = secret;
    el.type  = 'text';
}
</script>

<?php
require_once dirname(__DIR__, 2) . "/resources/footer.php";
