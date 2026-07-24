#!/usr/bin/env bash
# Redeploy Axus File Share to axus-server01 (sra alias).
# Syncs code (not data/.env), installs prod deps, restarts the service.
# Run from the repo root:  bash deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-sra}"
APP_DIR="/opt/axus-fileshare"

echo "==> Packing source"
TMP="$(mktemp -d)"
tar --exclude=node_modules --exclude=.git --exclude=data --exclude=.env \
    -czf "$TMP/app.tgz" server.js package.json package-lock.json lib deploy

echo "==> Uploading to $HOST:$APP_DIR"
scp -q "$TMP/app.tgz" "$HOST:/tmp/axfs-app.tgz"
ssh "$HOST" "sudo mkdir -p $APP_DIR && sudo chown ubuntu:ubuntu $APP_DIR && \
  tar -xzf /tmp/axfs-app.tgz -C $APP_DIR && rm /tmp/axfs-app.tgz && \
  cd $APP_DIR && npm install --omit=dev --no-audit --no-fund && \
  sudo systemctl restart axus-fileshare && sleep 1 && \
  systemctl is-active axus-fileshare"
rm -rf "$TMP"
echo "==> Done. https://sp.axustechnologies.com"
