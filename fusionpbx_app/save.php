<?php
/*
 * FusionPBX API Bridge — Save Settings
 * Handles POST from index.php settings form.
 */

require_once dirname(__DIR__, 2) . "/resources/require.php";

// ── Auth & CSRF ───────────────────────────────────────────────────────────────
if (!permission_exists('api_bridge_edit')) {
    die(json_encode(['error' => 'Access denied']));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: index.php');
    exit;
}

if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== ($_SESSION['token'] ?? '')) {
    $_SESSION['api_bridge_message']      = 'Invalid CSRF token. Please try again.';
    $_SESSION['api_bridge_message_type'] = 'danger';
    header('Location: index.php');
    exit;
}

// ── Fields to save ────────────────────────────────────────────────────────────
$fields = [
    'esl_host'           => ['type' => 'text',    'max' => 253],
    'esl_port'           => ['type' => 'numeric',  'min' => 1,    'max' => 65535],
    'esl_password'       => ['type' => 'text',    'max' => 500],
    'esl_reconnect_delay'=> ['type' => 'numeric',  'min' => 1,    'max' => 3600],
    'esl_max_reconnect'  => ['type' => 'numeric',  'min' => 1,    'max' => 1000],
    'api_port'           => ['type' => 'numeric',  'min' => 1024, 'max' => 65535],
    'api_key'            => ['type' => 'text',    'max' => 500],
    'jwt_secret'         => ['type' => 'text',    'max' => 500],
    'jwt_expire_hours'   => ['type' => 'numeric',  'min' => 1,    'max' => 8760],
    'service_name'       => ['type' => 'text',    'max' => 128],
    'service_path'       => ['type' => 'text',    'max' => 500],
];

$errors = [];
$values = [];

foreach ($fields as $key => $rules) {
    $val = trim($_POST[$key] ?? '');

    if ($rules['type'] === 'numeric') {
        if (!is_numeric($val)) {
            $errors[] = "$key must be a number.";
            continue;
        }
        $val = (int) $val;
        if (isset($rules['min']) && $val < $rules['min']) {
            $errors[] = "$key must be at least {$rules['min']}.";
            continue;
        }
        if (isset($rules['max']) && $val > $rules['max']) {
            $errors[] = "$key must be at most {$rules['max']}.";
            continue;
        }
        $values[$key] = (string) $val;
    } else {
        if (isset($rules['max']) && strlen($val) > $rules['max']) {
            $errors[] = "$key is too long.";
            continue;
        }
        $values[$key] = $val;
    }
}

// Validate api_key / jwt_secret are not left as obvious defaults
if (!empty($values['api_key']) && $values['api_key'] === 'change-me') {
    $errors[] = "API Key must not be 'change-me'. Please set a strong secret.";
}
if (!empty($values['jwt_secret']) && strlen($values['jwt_secret']) < 16) {
    $errors[] = "JWT Secret should be at least 16 characters.";
}

if (!empty($errors)) {
    $_SESSION['api_bridge_message']      = implode('<br>', $errors);
    $_SESSION['api_bridge_message_type'] = 'danger';
    header('Location: index.php');
    exit;
}

// ── Upsert into v_default_settings ───────────────────────────────────────────
$errors = [];

foreach ($values as $subcategory => $value) {
    // Check if row exists
    $sql = "SELECT default_setting_uuid
            FROM v_default_settings
            WHERE default_setting_category    = 'api_bridge'
              AND default_setting_subcategory = :sub
            LIMIT 1";
    $stmt = $db->prepare($sql);
    $stmt->bindParam(':sub', $subcategory);
    $stmt->execute();
    $existing = $stmt->fetchColumn();

    if ($existing) {
        $sql = "UPDATE v_default_settings
                SET default_setting_value   = :val,
                    default_setting_enabled = 'true'
                WHERE default_setting_uuid  = :uuid";
        $stmt = $db->prepare($sql);
        $stmt->bindParam(':val',  $value);
        $stmt->bindParam(':uuid', $existing);
        $stmt->execute();
    } else {
        $uuid = generate_uuid(); // FusionPBX helper
        $sql = "INSERT INTO v_default_settings
                    (default_setting_uuid, default_setting_category,
                     default_setting_subcategory, default_setting_name,
                     default_setting_value, default_setting_enabled)
                VALUES (:uuid, 'api_bridge', :sub, 'text', :val, 'true')";
        $stmt = $db->prepare($sql);
        $stmt->bindParam(':uuid', $uuid);
        $stmt->bindParam(':sub',  $subcategory);
        $stmt->bindParam(':val',  $value);
        $stmt->execute();
    }
}

// ── Optionally restart daemon ─────────────────────────────────────────────────
if (!empty($_POST['save_and_restart'])) {
    $service = escapeshellarg($values['service_name'] ?? 'fusionpbx-api-bridge');
    exec("sudo systemctl restart $service 2>&1", $out, $rc);
    if ($rc !== 0) {
        $_SESSION['api_bridge_message']      = 'Settings saved. Daemon restart failed: ' . implode(' ', $out);
        $_SESSION['api_bridge_message_type'] = 'warning';
        header('Location: index.php');
        exit;
    }
    $_SESSION['api_bridge_message']      = 'Settings saved and daemon restarted successfully.';
    $_SESSION['api_bridge_message_type'] = 'success';
} else {
    $_SESSION['api_bridge_message']      = 'Settings saved. Restart the daemon for changes to take effect.';
    $_SESSION['api_bridge_message_type'] = 'success';
}

header('Location: index.php');
exit;
