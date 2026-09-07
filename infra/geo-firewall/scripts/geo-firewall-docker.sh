#!/usr/bin/env bash
# Enforce the US/CA geo-block on Docker-published 443 via the DOCKER-USER chain.
# SSH (host INPUT) and ACME(80)/8443 are untouched. Idempotent (tagged "geofw").
set -euo pipefail
ipset list geo_allow -terse >/dev/null 2>&1 || /usr/local/sbin/geo-firewall-restore.sh
# Remove any prior geofw rules.
while iptables -L DOCKER-USER --line-numbers -n 2>/dev/null | grep -q 'geofw'; do
  n=$(iptables -L DOCKER-USER --line-numbers -n | awk '/geofw/{print $1; exit}')
  [ -n "$n" ] && iptables -D DOCKER-USER "$n" || break
done
# Insert (reverse order -> final: established RETURN, geo RETURN, 443 DROP).
iptables -I DOCKER-USER 1 -p tcp --dport 443 -m comment --comment geofw -j DROP
iptables -I DOCKER-USER 1 -p tcp --dport 443 -m set --match-set geo_allow src -m comment --comment geofw -j RETURN
iptables -I DOCKER-USER 1 -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment geofw -j RETURN
echo "DOCKER-USER geo rules applied"
