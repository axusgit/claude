#!/usr/bin/env bash
# Onboard a NEW Axus box to the US/CA geo-firewall AND connect it to the Hub,
# identically to the existing fleet. Idempotent — safe to re-run.
#
# Usage (run as root, from this directory):
#   sudo ./install.sh --name axus-newbox --token <GEO_FLEET_TOKEN> [options]
#
# Options:
#   --name NAME          box name shown in the Hub fleet list (required)
#   --token TOKEN        GEO_FLEET_TOKEN from the Hub's infra/.env (required)
#   --hub URL            Hub base URL (default https://hub.axustechnologies.com)
#   --enforcement MODE   ufw | docker | auto (default auto-detect)
#   --gated-tcp "P ..."  extra TCP ports to geo-gate (default "443")
#   --gated-udp "P ..."  UDP ports to geo-gate (default none; e.g. media range)
#
# The Hub's Country access control page then drives this box like the others.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

NAME=""; TOKEN=""; HUB="https://hub.axustechnologies.com"; ENF="auto"; GTCP="443"; GUDP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    --hub) HUB="$2"; shift 2;;
    --enforcement) ENF="$2"; shift 2;;
    --gated-tcp) GTCP="$2"; shift 2;;
    --gated-udp) GUDP="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 1;;
  esac
done
[ -n "$NAME" ]  || { echo "ERROR: --name required"; exit 1; }
[ -n "$TOKEN" ] || { echo "ERROR: --token required (GEO_FLEET_TOKEN from Hub infra/.env)"; exit 1; }

if [ "$ENF" = auto ]; then
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then ENF=ufw
  elif command -v docker >/dev/null 2>&1; then ENF=docker
  else ENF=ufw; fi
fi
echo "Onboarding $NAME  enforcement=$ENF  hub=$HUB"

SELF="$(cd "$(dirname "$0")" && pwd)"
apt-get update -qq && apt-get install -y -qq ipset >/dev/null 2>&1
mkdir -p /etc/geo-firewall/zones

install -m644 "$SELF/config/countries.conf"    /etc/geo-firewall/countries.conf
install -m644 "$SELF/config/always-allow.conf"  /etc/geo-firewall/always-allow.conf
install -m755 "$SELF/scripts/geo-firewall-update.sh"  /usr/local/sbin/geo-firewall-update.sh
install -m755 "$SELF/scripts/geo-firewall-restore.sh" /usr/local/sbin/geo-firewall-restore.sh
install -m755 "$SELF/scripts/geo-firewall-sync.sh"    /usr/local/sbin/geo-firewall-sync.sh
install -m755 "$SELF/scripts/geo-firewall-docker.sh"  /usr/local/sbin/geo-firewall-docker.sh

# Hub connection.
printf 'HUB_BASE=%s\nFLEET_TOKEN=%s\nBOX_NAME=%s\nENFORCEMENT=%s\n' "$HUB" "$TOKEN" "$NAME" "$ENF" > /etc/geo-firewall/hub.conf
chmod 600 /etc/geo-firewall/hub.conf

install -m644 "$SELF"/systemd/*.service "$SELF"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload

# Populate the allowlist now.
/usr/local/sbin/geo-firewall-update.sh

if [ "$ENF" = ufw ]; then
  systemctl enable geo-firewall.service >/dev/null 2>&1
  if ! grep -q "GEO ALLOWLIST START" /etc/ufw/before.rules; then
    cp /etc/ufw/before.rules /etc/ufw/before.rules.bak-geo
    {
      echo ""
      echo "# === GEO ALLOWLIST START (managed by geo-firewall; Hub-driven) ==="
      for p in $GTCP; do
        echo "-A ufw-before-input -p tcp --dport $p -m set --match-set geo_allow src -j ACCEPT"
        echo "-A ufw-before-input -p tcp --dport $p -j DROP"
      done
      for p in $GUDP; do
        echo "-A ufw-before-input -p udp --dport $p -m set --match-set geo_allow src -j ACCEPT"
        echo "-A ufw-before-input -p udp --dport $p -j DROP"
      done
      echo "# === GEO ALLOWLIST END ==="
    } > /tmp/geoblock
    sed -i "/ctstate INVALID -j DROP/r /tmp/geoblock" /etc/ufw/before.rules
    rm -f /tmp/geoblock
  fi
  ufw reload
else
  systemctl enable geo-firewall.service geo-firewall-docker.service >/dev/null 2>&1
  /usr/local/sbin/geo-firewall-docker.sh
fi

# Connect to the Hub: weekly refresh + 5-min policy sync + immediate first sync.
systemctl enable --now geo-firewall-update.timer >/dev/null 2>&1
systemctl enable --now geo-firewall-sync.timer >/dev/null 2>&1
systemctl start geo-firewall-sync.service || true

echo "DONE: $NAME onboarded ($ENF), following the Hub policy. It should appear in"
echo "the Hub's Country access control -> Server firewalls list within ~1 minute."
