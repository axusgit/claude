#!/usr/bin/env bash
# Daily compliance sweep for Axus Subcontractor Management: recomputes compliance
# and sends onboarding / COI-renewal / agreement-renewal reminders on their
# cadence. Idempotent — safe to run more than once a day (persisted reminder
# state + per-day de-dup prevent duplicate email). Install as a root cron once a
# day, e.g.:  15 13 * * *  /home/ubuntu/axus-platform/infra/subcontractors-compliance.sh >> /home/ubuntu/logs/subcontractors-compliance.log 2>&1
# (log to an app-writable path, NOT /var/log/, or cron silently aborts.)
# See axus-hub/subcontractors/backend/app/compliance.py.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /home/ubuntu/axus-platform/infra
docker compose exec -T subcontractors python -m app.compliance
