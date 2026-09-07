#!/usr/bin/env bash
# Restore the geo_allow ipset at boot (before ufw applies rules that reference it).
set -euo pipefail
if [ -f /etc/geo-firewall/geo_allow.ipset ]; then
  ipset restore -! < /etc/geo-firewall/geo_allow.ipset
else
  ipset create geo_allow hash:net family inet maxelem 262144 -exist
fi
