#!/usr/bin/env bash
# Daily reminder runner for Axus eSign: emails signers who haven't completed a
# SENT document, on the cadence set per document (daily/weekly/monthly).
# Installed as a root cron (once a day). See axus-hub/aesign/backend/src/reminders.ts.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /home/ubuntu/axus-platform/infra
docker compose exec -T aesign node dist/reminders.js
