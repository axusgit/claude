#!/usr/bin/env bash
#
# Nightly Docker build-cache trim (installed in root's crontab, 05:00 UTC = 1 AM ET).
#
# Build cache accumulates with every image rebuild/deploy and had grown to ~9 GB.
# This caps that growth while keeping the last 48h of cache, so a same-session set of
# re-deploys stays fast and only genuinely stale layers are dropped.
#
# Safe: `builder prune` only removes cached build layers — it never touches running
# containers, tagged images, or volumes.
#
set -euo pipefail

echo "[$(date -u +%FT%TZ)] docker builder prune (until=48h) — disk before: $(df -h / | awk 'NR==2{print $5" used, "$4" free"}')"
docker builder prune -af --filter until=48h
echo "[$(date -u +%FT%TZ)] done — disk after:  $(df -h / | awk 'NR==2{print $5" used, "$4" free"}')"
