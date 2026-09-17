#!/bin/bash
# Nightly SQLite hot backup of the Readiness Order DB (catalog config + quotes +
# usage log). Uses sqlite3 .backup for a consistent snapshot even under writes.
set -e
cd /opt/readiness-order
DIR=/opt/readiness-order/backups
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/prod-$TS.db"
sqlite3 prod.db ".backup '$OUT'"
gzip -f "$OUT"
# Retention: keep the most recent 30 daily backups.
ls -1t "$DIR"/prod-*.db.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "[$(date -Is)] backup ok -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1)) | $(ls -1 "$DIR"/prod-*.db.gz | wc -l) kept"
