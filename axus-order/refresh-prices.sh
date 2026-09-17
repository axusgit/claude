#!/bin/bash
# Nightly price refresh. Cron fires this at 05:00 and 06:00 UTC; it only runs when
# the Eastern hour is 01 (so it is exactly 1 AM ET year-round, DST-correct — this
# Debian cron ignores CRON_TZ, hence the in-script guard).
[ "$(TZ=America/New_York date +%H)" = "01" ] || exit 0
cd /opt/readiness-order || exit 1
SECRET=$(grep "^CRON_SECRET=" .env | cut -d= -f2-)
echo "[$(TZ=America/New_York date -Is)] refreshing prices..."
curl -s -X POST -H "x-cron-secret: $SECRET" http://127.0.0.1:3005/api/cron/refresh-prices --max-time 110
echo ""
