#!/usr/bin/env bash
# FusionPBX API Bridge — Server Installation Script
# Run as root on the FusionPBX server.
set -euo pipefail

SERVICE_NAME="fusionpbx-api-bridge"
INSTALL_DIR="/var/lib/fusionpbx-api-bridge"
APP_DIR="/var/www/fusionpbx/app/api_bridge"

echo "==> Installing FusionPBX API Bridge..."

# ── 1. Python check ───────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    apt-get install -y python3 python3-pip
fi
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "    Python $PY_VER found"

# ── 2. Create service directory and install Python source ─────────────────────
mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/fusionpbx-api-bridge
cp -r python/* "$INSTALL_DIR/"

pip3 install --upgrade pip --break-system-packages --root-user-action=ignore -q
pip3 install -r "$INSTALL_DIR/requirements.txt" --break-system-packages --root-user-action=ignore -q
echo "    Python dependencies installed"

# ── 3. Minimal .env (DB bootstrap only) ──────────────────────────────────────
FPBX_CONF="/etc/fusionpbx/config.conf"
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_NAME="fusionpbx"
DB_USER="fusionpbx"
DB_PASS=""

if [ -f "$FPBX_CONF" ]; then
    DB_HOST=$(grep -i "^host"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' \r')
    DB_PORT=$(grep -i "^port"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' \r')
    DB_NAME=$(grep -i "^name"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' \r')
    DB_USER=$(grep -i "^username" "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' \r')
    DB_PASS=$(grep -i "^password" "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' \r')
    echo "    DB credentials read from $FPBX_CONF"
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-fusionpbx}"
DB_USER="${DB_USER:-fusionpbx}"

if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" <<EOF
# DB bootstrap — all other settings are stored in FusionPBX v_default_settings
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
EOF
    echo "    .env written"
fi

chown -R www-data:www-data "$INSTALL_DIR"
chmod 640 "$INSTALL_DIR/.env"

# ── 4. Install FusionPBX PHP module ──────────────────────────────────────────
mkdir -p "$APP_DIR"
for f in app_config.php index.php save.php daemon.php; do
    [ -f "fusionpbx_app/$f" ] && cp "fusionpbx_app/$f" "$APP_DIR/"
done
chown -R www-data:www-data "$APP_DIR"
echo "    PHP module installed at $APP_DIR"

# ── 5. Register in FusionPBX database (settings, permissions, menu) ───────────
echo "    Registering in FusionPBX database..."

PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q <<'SQL'

-- Default settings
INSERT INTO v_default_settings
    (default_setting_uuid, default_setting_category, default_setting_subcategory,
     default_setting_name, default_setting_value, default_setting_enabled)
VALUES
    ('b1000001-0000-0000-0000-000000000001','api_bridge','esl_host',           'text','127.0.0.1',                'true'),
    ('b1000001-0000-0000-0000-000000000002','api_bridge','esl_port',           'text','8021',                     'true'),
    ('b1000001-0000-0000-0000-000000000003','api_bridge','esl_password',       'text','ClueCon',                  'true'),
    ('b1000001-0000-0000-0000-000000000004','api_bridge','api_port',           'text','3000',                     'true'),
    ('b1000001-0000-0000-0000-000000000005','api_bridge','api_key',            'text','',                         'true'),
    ('b1000001-0000-0000-0000-000000000006','api_bridge','jwt_secret',         'text','',                         'true'),
    ('b1000001-0000-0000-0000-000000000007','api_bridge','jwt_expire_hours',   'text','24',                       'true'),
    ('b1000001-0000-0000-0000-000000000008','api_bridge','service_name',       'text','fusionpbx-api-bridge',     'true'),
    ('b1000001-0000-0000-0000-000000000009','api_bridge','service_path',       'text','/var/lib/fusionpbx-api-bridge','true'),
    ('b1000001-0000-0000-0000-000000000010','api_bridge','esl_reconnect_delay','text','5',                        'true'),
    ('b1000001-0000-0000-0000-000000000011','api_bridge','esl_max_reconnect',  'text','10',                       'true')
ON CONFLICT (default_setting_uuid) DO NOTHING;

-- Permissions for superadmin and admin groups
INSERT INTO v_group_permissions
    (group_permission_uuid, group_name, permission_name, permission_assigned)
VALUES
    ('c2000001-0000-0000-0000-000000000001', 'superadmin', 'api_bridge_view', 'true'),
    ('c2000001-0000-0000-0000-000000000002', 'superadmin', 'api_bridge_edit', 'true'),
    ('c2000001-0000-0000-0000-000000000003', 'admin',      'api_bridge_view', 'true'),
    ('c2000001-0000-0000-0000-000000000004', 'admin',      'api_bridge_edit', 'true')
ON CONFLICT (group_permission_uuid) DO NOTHING;

-- Menu item (under the first Default menu found)
DO $$
DECLARE
    v_menu_uuid uuid;
BEGIN
    SELECT menu_uuid INTO v_menu_uuid
    FROM   v_menus
    WHERE  menu_name = 'Default'
    LIMIT  1;

    IF v_menu_uuid IS NOT NULL THEN
        INSERT INTO v_menu_items
            (menu_item_uuid, menu_uuid, menu_item_parent_uuid,
             menu_item_title, menu_item_link, menu_item_icon,
             menu_item_category, menu_item_order, menu_item_protected,
             menu_item_language)
        VALUES
            ('c3d4e5f6-a1b2-7890-abcd-123456789abc',
             v_menu_uuid, NULL,
             'API Bridge', '/app/api_bridge/index.php', 'apps',
             'admin', 200, 'false', 'en-us')
        ON CONFLICT (menu_item_uuid) DO NOTHING;
    END IF;
END $$;

SQL

echo "    Database records inserted"

# ── 6. Sudoers for daemon control ─────────────────────────────────────────────
SUDOERS_FILE="/etc/sudoers.d/$SERVICE_NAME"
cat > "$SUDOERS_FILE" <<EOF
# Allow FusionPBX web process to manage the API Bridge daemon
www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl start   $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop    $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable  $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /usr/bin/systemctl show    $SERVICE_NAME --property=ActiveEnterTimestamp
EOF
chmod 440 "$SUDOERS_FILE"
echo "    Sudoers written to $SUDOERS_FILE"

# ── 7. systemd service ────────────────────────────────────────────────────────
cp "fusionpbx_app/install/fusionpbx-api-bridge.service" \
   "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start  "$SERVICE_NAME"
echo "    Service $SERVICE_NAME started and enabled"

echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Go to Admin → API Bridge in FusionPBX to configure ESL password, API key, etc."
echo "  2. Click 'Save & Restart' to apply settings."
echo "  (If you don't see the menu item yet, log out and back in to refresh the session.)"
echo ""
echo "Logs:   journalctl -u $SERVICE_NAME -f"
echo "Status: systemctl status $SERVICE_NAME"
