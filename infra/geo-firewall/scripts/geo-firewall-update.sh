#!/usr/bin/env bash
# Rebuild the geo_allow ipset from countries.conf + always-allow.conf.
set -euo pipefail
CONF=/etc/geo-firewall/countries.conf
EXTRA=/etc/geo-firewall/always-allow.conf
ZONEDIR=/etc/geo-firewall/zones
SAVE=/etc/geo-firewall/geo_allow.ipset
TMP=geo_allow_tmp
mkdir -p "$ZONEDIR"
ipset create geo_allow hash:net family inet hashsize 8192 maxelem 262144 -exist
ipset create "$TMP"      hash:net family inet hashsize 8192 maxelem 262144 -exist
ipset flush "$TMP"
# Countries from ipdeny.com aggregated zones (cached in ZONEDIR if a fetch fails).
while read -r line; do
  cc=$(printf "%s" "$line" | sed "s/#.*//" | tr -d "[:space:]" | tr "A-Z" "a-z")
  [ -z "$cc" ] && continue
  url="https://www.ipdeny.com/ipblocks/data/aggregated/${cc}-aggregated.zone"
  curl -fsS --max-time 30 "$url" -o "$ZONEDIR/${cc}.zone" || echo "warn: fetch $cc failed, using cache"
  [ -f "$ZONEDIR/${cc}.zone" ] || { echo "warn: no zone for $cc"; continue; }
  while read -r net; do [ -n "$net" ] && ipset add "$TMP" "$net" -exist; done < "$ZONEDIR/${cc}.zone"
done < "$CONF"
# Always-allow extras (Axus infra / office).
if [ -f "$EXTRA" ]; then
  while read -r line; do
    net=$(printf "%s" "$line" | sed "s/#.*//" | tr -d "[:space:]")
    [ -z "$net" ] && continue
    ipset add "$TMP" "$net" -exist
  done < "$EXTRA"
fi
# Safety: refuse a suspiciously small rebuild (e.g. source down + no cache) so we
# never accidentally lock out all legitimate traffic. Keep the existing set.
CNT=$(ipset list "$TMP" | grep -c "/")
if [ "$CNT" -lt 1000 ]; then
  echo "ABORT: only $CNT networks built (source unreachable?); keeping existing geo_allow"
  ipset destroy "$TMP"
  exit 1
fi
ipset swap "$TMP" geo_allow
ipset destroy "$TMP"
ipset save geo_allow > "$SAVE"
echo "geo_allow: $CNT networks; saved to $SAVE"
