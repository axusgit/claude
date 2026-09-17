#!/bin/bash
# Retry quote emails that failed to send (e.g. transient M365 outages). Runs every 10 min
# from cron; only logs when it actually retried something.
cd /opt/readiness-order || exit 1
SECRET=$(grep "^CRON_SECRET=" .env | cut -d= -f2-)
RESP=$(curl -s -X POST -H "x-cron-secret: $SECRET" http://127.0.0.1:3005/api/cron/retry-emails --max-time 110)
echo "$RESP" | grep -q '"retried":0' || echo "[$(TZ=America/New_York date -Is)] $RESP"