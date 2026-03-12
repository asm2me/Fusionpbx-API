<?php
/*
 * FusionPBX API Bridge — Daemon Control
 * Handles start / stop / restart / enable actions.
 * Returns JSON so it can also be called via AJAX.
 */

require_once dirname(__DIR__, 2) . "/resources/require.php";

header('Content-Type: application/json');

function api_bridge_can(string $perm): bool {
    if (function_exists('permission_exists') && permission_exists($perm)) {
        return true;
    }
    $groups = $_SESSION['groups'] ?? [];
    if (isset($groups['superadmin']) || isset($groups['admin'])) {
        return true;
    }
    if (!empty($_SESSION['user_uuid'])) {
        foreach ($groups as $key => $val) {
            $name = is_array($val) ? ($val['group_name'] ?? $key) : $key;
            if ($name === 'superadmin' || $name === 'admin') {
                return true;
            }
        }
    }
    return false;
}

// ── Auth & CSRF ───────────────────────────────────────────────────────────────
if (!api_bridge_can('api_bridge_edit')) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Access denied']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== ($_SESSION['token'] ?? '')) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Invalid CSRF token']);
    exit;
}

// ── Ensure DB connection ──────────────────────────────────────────────────────
if (empty($db)) {
    $database = new database;
    $database->connect();
    $db = $database->db;
}

// ── Load service name from settings ──────────────────────────────────────────
$sql = "SELECT default_setting_value FROM v_default_settings
        WHERE default_setting_category    = 'api_bridge'
          AND default_setting_subcategory = 'service_name'
          AND default_setting_enabled     = 'true'
        LIMIT 1";
$stmt = $db->query($sql);
$service = $stmt ? ($stmt->fetchColumn() ?: 'fusionpbx-api-bridge') : 'fusionpbx-api-bridge';
$service = escapeshellarg($service);

// ── Allowed actions ───────────────────────────────────────────────────────────
$allowed = ['start', 'stop', 'restart', 'enable'];
$action  = $_POST['action'] ?? '';

if (!in_array($action, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid action']);
    exit;
}

// ── Execute via sudo ──────────────────────────────────────────────────────────
$cmd    = "sudo /bin/systemctl {$action} {$service} 2>&1";
$output = [];
exec($cmd, $output, $rc);

$messages = [
    'start'   => 'Service started',
    'stop'    => 'Service stopped',
    'restart' => 'Service restarted',
    'enable'  => 'Service enabled for auto-start',
];

if ($rc !== 0) {
    echo json_encode([
        'success' => false,
        'message' => 'Command failed: ' . implode('; ', $output),
        'code'    => $rc,
    ]);
} else {
    // Set flash message for redirect
    $_SESSION['api_bridge_message']      = $messages[$action] ?? 'Done.';
    $_SESSION['api_bridge_message_type'] = 'success';

    echo json_encode([
        'success' => true,
        'message' => $messages[$action] ?? 'Done.',
        'redirect'=> 'index.php',
    ]);
}
