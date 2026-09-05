# VoIP Network Capacity Tester

Simulates real voice calls as genuine RTP streams to measure whether a network
can sustain _N_ concurrent calls on **G.711** or **G.729**, and reports the
call quality under that load (loss, jitter, delay, R-factor/MOS) with a
pass/fail verdict.

Two Go binaries, one module:

| Binary | Role |
| --- | --- |
| `collector` | Server: HTTP/JSON control API, per-test RTP echo endpoint, live aggregation, **web dashboard** (SSE), and report generation — all one binary, one port. |
| `probe` | Client: single Windows `.exe`. Claims a CODE, pulls config, runs the calls, measures the round trip, streams stats back, writes the report. Headless. |

## Build

Go 1.22+ required. (This repo was built with the portable Go SDK at
`C:\Users\Andy\sdk\go`.)

```powershell
# from the repo root
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

or manually:

```bash
go build -o bin/collector.exe ./cmd/collector
go build -o bin/probe.exe     ./cmd/probe   # single self-contained .exe
```

Cross-compile the probe for Windows from any OS:

```bash
GOOS=windows GOARCH=amd64 go build -o probe.exe ./cmd/probe
```

## Run

**1. Start the collector** (on a machine reachable by the clients under test):

```powershell
.\bin\collector.exe -addr :8080
```

Open the dashboard at `http://<collector-host>:8080/`.

Flags:
- `-addr` — HTTP listen address for the API **and** dashboard (default `:8080`).
- `-media-bind` — interface to bind the RTP echo listeners on (default: all).
- `-advertise` — media host advertised to clients. Default: the hostname the
  client used to reach the API, which is usually what you want.

**2. Create a test** (operator), e.g. 50 concurrent G.711 calls over UDP:

```bash
curl -X POST http://collector:8080/api/tests \
  -d '{"codec":"g711","channels":50,"transport":"udp","duration_sec":60,"ptime_ms":20}'
# -> {"code":"AB12CD", ...}
```

**3. Run the probe** inside the network under test:

```powershell
.\probe.exe -server http://collector:8080 -code AB12CD
```

The probe prints the tiered report and writes `AB12CD-<timestamp>.{txt,json,csv}`.

### One-shot convenience

The probe can create the test and run it in one go (handy for a single machine):

```powershell
.\probe.exe -server http://collector:8080 -codec g729 -channels 20 -transport tcp -duration 30 -ptime 20
```

## Media & transport

Each channel is one bidirectional simulated call carried as **real RTP**
(RFC 3550): a proper 12-byte header (V/PT/seq/timestamp/SSRC), correct static
payload types (**PT 0** G.711 µ-law, **PT 18** G.729), and correctly sized
synthetic payload. Per-packet sizing at the IP layer:

| Codec | payload @20ms | + RTP/UDP/IP | bitrate/call |
| --- | --- | --- | --- |
| G.711 | 160 B | 200 B | ~80 kbps |
| G.729 | 20 B | 60 B | ~24 kbps |

`ptime` is configurable (10/20/30 ms); payload scales accordingly.

**Transport is chosen per test** and every channel uses it:
- **UDP** — standard RTP over UDP.
- **TCP** — RTP framed with **RFC 4571** (2-byte big-endian length prefix per
  packet), **one TCP connection per channel** (no multiplexing, to avoid
  cross-channel head-of-line blocking). TCP retransmits and Nagle inflate
  jitter/RTT and mask loss versus UDP — this is expected and is called out in
  the report and dashboard.

The collector is the far-end peer: it **echoes** each received packet back to
the sender, so the probe measures the full round trip.

## Metrics

Measured per channel and aggregated. Because the probe measures on the echoed
stream, values describe the **round-trip** path (client → collector → client):

- **Delay** — RTT (min/mean/max/p95) from a send-timestamp embedded in each
  payload. One-way delay is **estimated as RTT/2 and labelled an estimate**
  (clocks are not assumed NTP-synced). Targets per ITU-T G.114 (<150 ms).
- **Jitter** — RFC 3550 interarrival jitter (smoothed `J`), plus peak and p95.
- **Loss** — from RTP sequence gaps; **burst vs isolated** distribution,
  longest burst, and burst ratio (fed into the E-model). Out-of-order and
  duplicate counts.
- **Volume** — packets expected/sent/received, bytes, achieved vs expected
  bitrate (IP layer).
- **Quality** — **ITU-T G.107 E-model**: R-factor from one-way delay and
  effective (burst-aware) loss with codec `Ie`/`Bpl` (G.711: 0 / 25.1,
  G.729: 11 / 19.0), then `MOS = 1 + 0.035R + 7e-6·R(R-60)(100-R)`.
- **Verdict** — per-parameter pass/fail against configurable thresholds
  (defaults: loss <1%, jitter <30 ms, one-way <150 ms, MOS ≥4.0). Overall
  test passes only if every channel passes.

## Report

Three forms, summary-first, from both the probe (local files) and the server
(`/api/tests/{code}/report?format=txt|json|csv`):

1. **Header** — CODE, timestamp, client identity/IP, echoed config, and the
   overall PASS/FAIL verdict up top.
2. **Aggregate** — the full parameter set across all channels with
   min/mean/max/p95 for delay & jitter and worst-channel callouts.
3. **Per-channel table** — one row per channel: loss %, jitter, RTT, one-way,
   throughput, R-factor, MOS, verdict.

## Dashboard

Served from the same binary/port (`go:embed`, no external JS). Live via SSE:

- **Test list** — every test with CODE, state (created/claimed/running/
  complete/expired), codec, transport, channels, client IP, elapsed/remaining.
- **Live detail** (click a CODE) — real-time aggregate KPIs.
- **Per-channel live table** — worst channel visible at a glance.
- **Live charts** — rolling loss %, jitter, and MOS over the test duration.

## Control API

| Method & path | Purpose |
| --- | --- |
| `POST /api/tests` | Create a test; returns CODE + media endpoint. |
| `GET /api/tests` | List all tests (summaries). |
| `GET /api/tests/{code}` | Test detail (JSON). |
| `POST /api/tests/{code}/claim` | Client claims a CODE (409 if already active). |
| `POST /api/tests/{code}/stats` | Client streams stats. |
| `GET /api/tests/{code}/stream` | SSE: live detail for one test. |
| `GET /api/stream` | SSE: live test list. |
| `GET /api/tests/{code}/report?format=` | `txt` (default), `json`, `csv`. |

## Design notes / limitations

- **One CODE = one client session.** The probe refuses a second concurrent run
  in-process; the server returns **409** to a second client claiming an active
  CODE.
- **Round-trip measurement.** Loss/jitter are measured on the echoed stream, so
  they reflect both directions combined. This keeps RTT direct and the design
  simple; per-direction numbers would require the collector to also measure the
  inbound stream.
- **Burst stats are gap-based.** Loss runs are classified when a sequence gap is
  detected at the in-order boundary; a late (reordered) packet is counted
  separately as `reordered` and corrects the authoritative loss total, but does
  not retroactively rewrite the burst histogram.
- **Pacing** uses an absolute schedule (`start + n·ptime`) so it does not drift
  even when the OS timer is coarse (notably on Windows).
- Tests that are never claimed, or go silent well past their duration, are
  expired by a janitor and their media ports freed.

## Tests

```bash
go test ./...
```

Covers loss/burst/isolated classification, reorder & duplicate detection,
RTT and jitter math, verdict logic, aggregation, the E-model (ideal R=93.2,
loss/delay/burstiness degradation, G.729 < G.711 ceiling), and RFC 4571 framing.
