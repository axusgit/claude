#!/usr/bin/env bash
# Redeploy Axus Syslog to its own box (ssh alias `syslog01`).
# Syncs code (not data/.env), installs prod deps, restarts the service.
# Run from the repo root:  bash deploy/deploy.sh
#
# First-time provisioning (run once, by hand — see deploy/SETUP.md) installs the
# systemd unit, nginx vhost, TLS cert, and opens UDP 514. This script only
# updates the running app afterwards.
set -euo pipefail

HOST="${DEPLOY_HOST:-syslog01}"
APP_DIR="/opt/axus-syslog"

echo "==> Packing source"
TMP="$(mktemp -d)"
tar --exclude=node_modules --exclude=.git --exclude=data --exclude=.env \
    -czf "$TMP/app.tgz" server.js package.json package-lock.json lib deploy

echo "==> Uploading to $HOST:$APP_DIR"
scp -q "$TMP/app.tgz" "$HOST:/tmp/axsyslog-app.tgz"
ssh "$HOST" "sudo mkdir -p $APP_DIR && sudo chown ubuntu:ubuntu $APP_DIR && \
  tar -xzf /tmp/axsyslog-app.tgz -C $APP_DIR && rm /tmp/axsyslog-app.tgz && \
  cd $APP_DIR && npm install --omit=dev --no-audit --no-fund && \
  sudo systemctl restart axus-syslog && sleep 1 && \
  systemctl is-active axus-syslog"
rm -rf "$TMP"
echo "==> Done. https://syslog.axustechnologies.com"
