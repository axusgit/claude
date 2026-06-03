#!/usr/bin/env bash
#
# Axus Hub — production deploy script. Run on the server:
#   bash "/var/www/axushub/Axus Hub/backend/deploy.sh"
#
# Pulls latest code, installs deps, backs up the DB, runs migrations,
# restarts the service, and health-checks. Safe to re-run.
#
set -euo pipefail

REPO_DIR="/var/www/axushub"
BACKEND_DIR="$REPO_DIR/Axus Hub/backend"
SERVICE="axushub"
DB_NAME="axushub"
PIP="$BACKEND_DIR/venv/bin/pip"
ALEMBIC="$BACKEND_DIR/venv/bin/alembic"

echo "==> 1/6 Pulling latest code"
git -C "$REPO_DIR" pull origin main

echo "==> 2/6 Installing dependencies"
"$PIP" install -q -r "$BACKEND_DIR/requirements.txt"

echo "==> 3/6 Backing up database"
BACKUP="$HOME/axushub-backup-$(date +%F-%H%M%S).sql"
if sudo -u postgres pg_dump "$DB_NAME" > "$BACKUP" 2>/dev/null; then
  echo "    saved $BACKUP"
else
  echo "    WARNING: backup failed (continuing anyway)"
fi

echo "==> 4/6 Running database migrations"
( cd "$BACKEND_DIR" && "$ALEMBIC" upgrade head )

echo "==> 5/6 Restarting service"
sudo systemctl restart "$SERVICE"

echo "==> 6/6 Health check"
sleep 2
if curl -fsS http://127.0.0.1:8000/api/health > /dev/null; then
  echo "    OK - deploy complete: https://hub.axustechnologies.com"
else
  echo "    FAILED health check - inspect: sudo journalctl -u $SERVICE -n 40 --no-pager"
  exit 1
fi
