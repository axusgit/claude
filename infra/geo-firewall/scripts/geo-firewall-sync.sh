#!/usr/bin/env bash
# Pull the country allowlist from the Axus Hub and apply it to this box's
# OS-level geo-firewall, then report status back. Runs as root from a timer.
set -uo pipefail
CONF=/etc/geo-firewall/hub.conf
[ -f "$CONF" ] || { echo "no $CONF"; exit 0; }
# shellcheck disable=SC1090
. "$CONF"   # HUB_BASE, FLEET_TOKEN, BOX_NAME, ENFORCEMENT
LASTF=/etc/geo-firewall/.last_version

resp=$(curl -fsS --max-time 20 -H "Authorization: Bearer $FLEET_TOKEN" "$HUB_BASE/api/geo/allowlist") || { echo "allowlist fetch failed"; exit 0; }
mode=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("mode","off"))' 2>/dev/null) || exit 0
version=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version","0"))')
countries=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(" ".join(c.lower() for c in json.load(sys.stdin).get("countries",[])))')

last=$(cat "$LASTF" 2>/dev/null || echo "")
if [ "$version" != "$last" ]; then
  if [ "$mode" = "allow" ]; then
    { echo "# Managed by the Axus Hub geo policy — edit countries in the Hub GUI, not here."
      for c in $countries; do echo "$c"; done; } > /etc/geo-firewall/countries.conf
    /usr/local/sbin/geo-firewall-update.sh >/dev/null 2>&1 || true
  elif [ "$mode" = "off" ]; then
    ipset create geo_allow hash:net family inet maxelem 262144 -exist
    ipset flush geo_allow; ipset add geo_allow 0.0.0.0/0 -exist
    ipset save geo_allow > /etc/geo-firewall/geo_allow.ipset
  else
    echo "mode=$mode not enforced at OS layer (edge-only); leaving firewall as-is"
  fi
  [ "${ENFORCEMENT:-}" = docker ] && /usr/local/sbin/geo-firewall-docker.sh >/dev/null 2>&1 || true
  echo "$version" > "$LASTF"
fi

entries=$(ipset list geo_allow -terse 2>/dev/null | awk -F': ' '/entries/{print $2}')
python3 - "$HUB_BASE" "$FLEET_TOKEN" "$BOX_NAME" "$mode" "$countries" "${entries:-0}" "$version" "${ENFORCEMENT:-}" <<'PY'
import sys,json,urllib.request
base,tok,box,mode,countries,entries,version,enf=sys.argv[1:9]
body=json.dumps({"box":box,"mode":mode,"countries":countries.upper().split() if countries else [],
                 "entries":int(entries or 0),"version":version,"enforcement":enf}).encode()
req=urllib.request.Request(base+"/api/geo/heartbeat",data=body,
      headers={"Authorization":"Bearer "+tok,"Content-Type":"application/json"})
try: urllib.request.urlopen(req,timeout=15).read()
except Exception as e: print("heartbeat failed:",e)
PY
