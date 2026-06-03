"""Country-based access control for the platform edge.

Traefik calls /api/geo/check (in main.py) as a forward-auth gate; this module
resolves the source country offline (geoip2fast, no API key) and evaluates it
against the Hub-managed policy. Private/loopback and unknown IPs fail OPEN so a
bad lookup never locks the platform out.
"""
import os
import json
import ipaddress
import threading

try:
    from geoip2fast import GeoIP2Fast
    _geoip = GeoIP2Fast()
except Exception:  # package or data missing -> lookups return "" (fail open)
    _geoip = None

GEO_POLICY_PATH = os.getenv("GEO_POLICY_PATH", "geo_policy.json")
DEFAULT_POLICY = {"mode": "off", "countries": []}  # mode: off | allow | deny

_cache = {"mtime": None, "policy": None}
_lock = threading.Lock()


def load_policy() -> dict:
    try:
        m = os.path.getmtime(GEO_POLICY_PATH)
    except OSError:
        return DEFAULT_POLICY
    if _cache["mtime"] != m:
        try:
            with open(GEO_POLICY_PATH, encoding="utf-8") as f:
                _cache["policy"] = json.load(f)
            _cache["mtime"] = m
        except Exception:
            return DEFAULT_POLICY
    return _cache["policy"] or DEFAULT_POLICY


def save_policy(policy: dict) -> dict:
    clean = {
        "mode": policy.get("mode", "off"),
        "countries": sorted({str(c).upper() for c in policy.get("countries", []) if c}),
    }
    with _lock:
        with open(GEO_POLICY_PATH, "w", encoding="utf-8") as f:
            json.dump(clean, f)
        _cache["mtime"] = None  # force reload on next read
    return clean


def country_of(ip: str) -> str:
    if not _geoip:
        return ""
    try:
        cc = (getattr(_geoip.lookup(ip), "country_code", "") or "").upper()
        return "" if cc in ("", "--", "XX") else cc
    except Exception:
        return ""


def _is_private(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
        return a.is_private or a.is_loopback or a.is_link_local
    except ValueError:
        return False


def client_ip(x_forwarded_for: str, fallback: str) -> str:
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0].strip()
    return fallback or ""


def evaluate(ip: str):
    """Return (allowed: bool, country: str)."""
    if not ip or _is_private(ip):
        return True, "private"
    policy = load_policy()
    mode = policy.get("mode", "off")
    cc = country_of(ip)
    if mode == "off":
        return True, cc
    if not cc:
        return True, ""  # unknown country -> fail open
    countries = {c.upper() for c in policy.get("countries", [])}
    if mode == "allow":
        return cc in countries, cc
    if mode == "deny":
        return cc not in countries, cc
    return True, cc
