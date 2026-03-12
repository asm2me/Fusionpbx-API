#!/usr/bin/env bash
# FusionPBX API Bridge — Server Installation Script
# Run as root on the FusionPBX server.
set -euo pipefail

SERVICE_NAME="fusionpbx-api-bridge"
INSTALL_DIR="/var/lib/fusionpbx-api-bridge"
APP_DIR="/var/www/fusionpbx/app/api_bridge"
PYTHON_MIN="3.10"

echo "==> Installing FusionPBX API Bridge..."

# ── 1. Python check ───────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    apt-get install -y python3 python3-pip
fi
PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "    Python $PY_VER found"

# ── 2. Create service directory ───────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/fusionpbx-api-bridge

# Copy Python source (run from project root)
cp -r python/* "$INSTALL_DIR/"

# Install dependencies system-wide (--break-system-packages required on Debian 12+)
pip3 install --upgrade pip --break-system-packages -q
pip3 install -r "$INSTALL_DIR/requirements.txt" --break-system-packages -q

# ── 3. Minimal .env (DB bootstrap only) ──────────────────────────────────────
# The rest of the settings come from FusionPBX v_default_settings.
if [ ! -f "$INSTALL_DIR/.env" ]; then
    # Try to auto-detect FusionPBX DB credentials
    FPBX_CONF="/etc/fusionpbx/config.conf"
    if [ -f "$FPBX_CONF" ]; then
        DB_HOST=$(grep -i "^host"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        DB_PORT=$(grep -i "^port"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        DB_NAME=$(grep -i "^name"     "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        DB_USER=$(grep -i "^username" "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        DB_PASS=$(grep -i "^password" "$FPBX_CONF" | awk -F'=' '{print $2}' | tr -d ' ')
        cat > "$INSTALL_DIR/.env" <<EOF
# DB bootstrap — other settings come from FusionPBX Admin > API Bridge
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-fusionpbx}
DB_USER=${DB_USER:-fusionpbx}
DB_PASSWORD=${DB_PASS}
EOF
        echo "    .env created from $FPBX_CONF"
    else
        cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
        echo "    .env.example copied — edit $INSTALL_DIR/.env with your DB credentials!"
    fi
fi

chown -R www-data:www-data "$INSTALL_DIR"
chmod 640 "$INSTALL_DIR/.env"

# ── 4. Install FusionPBX PHP module ──────────────────────────────────────────
mkdir -p "$APP_DIR"
# Copy PHP app files (excluding install/)
for f in app_config.php index.php save.php daemon.php; do
    [ -f "fusionpbx_app/$f" ] && cp "fusionpbx_app/$f" "$APP_DIR/"
done
chown -R www-data:www-data "$APP_DIR"
echo "    PHP module installed at $APP_DIR"
echo "    → Go to FusionPBX Admin > App Defaults and click Update to register settings & menu."

# ── 5. Sudoers for daemon control ─────────────────────────────────────────────
SUDOERS_FILE="/etc/sudoers.d/$SERVICE_NAME"
cat > "$SUDOERS_FILE" <<EOF
# Allow FusionPBX web process to manage the API Bridge daemon
www-data ALL=(ALL) NOPASSWD: /bin/systemctl start   $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /bin/systemctl stop    $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /bin/systemctl restart $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /bin/systemctl enable  $SERVICE_NAME
www-data ALL=(ALL) NOPASSWD: /bin/systemctl show    $SERVICE_NAME --property=ActiveEnterTimestamp
EOF
chmod 440 "$SUDOERS_FILE"
echo "    Sudoers written to $SUDOERS_FILE"

# ── 6. systemd service ────────────────────────────────────────────────────────
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
echo "  1. In FusionPBX: Admin → App Defaults → Update"
echo "  2. Go to Admin → API Bridge to configure ESL password, API key, etc."
echo "  3. Click 'Save & Restart' to apply settings."
echo ""
echo "Logs:   journalctl -u $SERVICE_NAME -f"
echo "Status: systemctl status $SERVICE_NAME"
