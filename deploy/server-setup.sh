#!/usr/bin/env bash
# One-shot setup of "My money" on a fresh Ubuntu/Debian VPS.
# Run as root:   bash server-setup.sh [your-domain]
# Without a domain it uses <ip-with-dashes>.sslip.io so HTTPS works out of the box.
set -euo pipefail

REPO="${REPO:-git@github.com:fndgrow/peter-money-flow.git}"
APP_DIR=/opt/my-money
DATA_DIR=/var/lib/my-money
DOMAIN="${1:-}"

if [ -z "$DOMAIN" ]; then
  IP=$(curl -4 -s https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
fi
echo "==> Domain: $DOMAIN"

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  echo "==> Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

if ! command -v caddy >/dev/null; then
  echo "==> Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "==> App user and folders"
id -u mymoney >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin mymoney
mkdir -p "$APP_DIR" "$DATA_DIR"

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
elif [ -f "$APP_DIR/package.json" ]; then
  echo "   using code already present in $APP_DIR"
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
chown -R mymoney:mymoney "$APP_DIR" "$DATA_DIR"

echo "==> systemd service"
cat >/etc/systemd/system/my-money.service <<EOF
[Unit]
Description=My money
After=network.target

[Service]
User=mymoney
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=$DATA_DIR
Environment=COOKIE_SECURE=true
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now my-money
systemctl restart my-money

echo "==> Caddy (HTTPS)"
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo
echo "Done. Open:  https://$DOMAIN"
echo "The first visit sets the password. Then install it from the browser menu."
echo
echo "Update later with:  cd $APP_DIR && git pull && npm ci && npm run build && systemctl restart my-money"
