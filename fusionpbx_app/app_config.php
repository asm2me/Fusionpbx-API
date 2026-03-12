<?php
/*
 * FusionPBX API Bridge — App Config
 * Registers the app, default settings, menu items and permissions.
 * Install via Admin > App Defaults > Update.
 */

$apps[$x]['name']        = 'API Bridge';
$apps[$x]['uuid']        = 'c3d4e5f6-a1b2-7890-abcd-123456789abc';
$apps[$x]['category']    = 'Admin';
$apps[$x]['subcategory'] = '';
$apps[$x]['version']     = '1.0';
$apps[$x]['license']     = 'Mozilla Public License 1.1';
$apps[$x]['url']         = 'https://github.com';
$apps[$x]['description'] = 'REST API + WebSocket bridge for CRM/FreeSWITCH integration';
$apps[$x]['sort']        = '90';

// ── Menu ─────────────────────────────────────────────────────────────────────

$y = 0;
$apps[$x]['menu'][$y]['title']     = 'API Bridge';
$apps[$x]['menu'][$y]['category']  = 'admin';
$apps[$x]['menu'][$y]['protected'] = 'false';
$apps[$x]['menu'][$y]['link']      = 'app/api_bridge/index.php';
$apps[$x]['menu'][$y]['icon']      = 'apps';
$apps[$x]['menu'][$y]['groups'][]  = 'superadmin';
$apps[$x]['menu'][$y]['groups'][]  = 'admin';
$y++;

// ── Permissions ───────────────────────────────────────────────────────────────

$p = 0;
$apps[$x]['permissions'][$p]['name']  = 'api_bridge_view';
$apps[$x]['permissions'][$p]['groups'][] = 'superadmin';
$apps[$x]['permissions'][$p]['groups'][] = 'admin';
$p++;

$apps[$x]['permissions'][$p]['name']  = 'api_bridge_edit';
$apps[$x]['permissions'][$p]['groups'][] = 'superadmin';
$apps[$x]['permissions'][$p]['groups'][] = 'admin';
$p++;

// ── Default Settings ──────────────────────────────────────────────────────────

$i = 0;

// ESL
$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000001';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'esl_host';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '127.0.0.1';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'FreeSWITCH ESL host address';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000002';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'esl_port';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '8021';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'FreeSWITCH ESL port';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000003';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'esl_password';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = 'ClueCon';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'FreeSWITCH ESL password (event_socket.conf.xml)';
$i++;

// API Server
$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000004';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'api_port';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '3000';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'API bridge listening port';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000005';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'api_key';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'Shared secret for CRM authentication (X-API-Key header)';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000006';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'jwt_secret';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'JWT signing secret (min 32 chars)';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000007';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'jwt_expire_hours';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '24';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'JWT token validity in hours';
$i++;

// Service / Paths
$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000008';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'service_name';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = 'fusionpbx-api-bridge';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'systemd service unit name';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000009';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'service_path';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '/var/lib/fusionpbx-api-bridge';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'Absolute path to the Python service directory';
$i++;

// Reconnect
$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000010';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'esl_reconnect_delay';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '5';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'Seconds between ESL reconnect attempts';
$i++;

$apps[$x]['default_settings'][$i]['default_setting_uuid']         = 'b1000001-0000-0000-0000-000000000011';
$apps[$x]['default_settings'][$i]['default_setting_category']     = 'api_bridge';
$apps[$x]['default_settings'][$i]['default_setting_subcategory']  = 'esl_max_reconnect';
$apps[$x]['default_settings'][$i]['default_setting_name']         = 'text';
$apps[$x]['default_settings'][$i]['default_setting_value']        = '10';
$apps[$x]['default_settings'][$i]['default_setting_enabled']      = 'true';
$apps[$x]['default_settings'][$i]['default_setting_description']  = 'Maximum ESL reconnect attempts before giving up';
$i++;
