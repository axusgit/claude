# VoIP Network Capacity Tester

Simulates real voice calls as genuine RTP streams to measure whether a network
can sustain _N_ concurrent calls on **G.711, G.729, G.722 or Opus**, and reports the
call quality under that load (loss, jitter, delay, R-factor/MOS) with a
pass/fail verdict.

Three Go binaries, one module:

| Binary | Role |
| --- | --- |
| `collector` | Server: HTTP/JSON control API, per-test RTP echo endpoint, live aggregation, **web dashboard** (SSE), and report generation — all one binary, one port. |
| `voiptesterprobe` | **GUI** client (recommended for technicians): a resident Windows app. Downloaded pre-bound to a test, it auto-connects and runs, then stays in the system tray until reboot. Single self-contained `.exe`. |
| `voiptesterprobe-cli` | **Console** client: single headless Windows `.exe`. Claims a CODE, pulls config, runs the calls, measures the round trip, streams stats back, writes the report. |

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
go build -o bin/voiptesterprobe-cli.exe     ./cmd/probe   # single self-contained .exe
```

Cross-compile the probe for Windows from any OS:

```bash
GOOS=windows GOARCH=amd64 go build -o voiptesterprobe-cli.exe ./cmd/probe
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
- `-data-dir` — directory to **persist completed test reports** so history and
  the compare view survive a collector restart (default: in-memory only). Each
  finished test is written as `<CODE>.json` and reloaded on startup.
- `-media-port-min` / `-media-port-max` — pin the per-test RTP echo ports to a
  fixed range so a cloud firewall can allow just those (default: ephemeral). One
  port per concurrent test is used from the range.
- `-voiptesterprobe-cli-exe` — path to a `voiptesterprobe-cli.exe` to serve at `/download/voiptesterprobe-cli.exe`, so the
  dashboard's create screen can offer it as a download.
- `-voiptesterprobe-exe` — path to a `voiptesterprobe.exe` to serve at `/download/voiptesterprobe.exe`.
  The dashboard's create screen then offers a **pre-bound** GUI probe download: a
  small config trailer carrying this collector's URL and the test's CODE is
  appended to the .exe at download time, so the technician just runs it and it
  connects and starts on its own (see below). Example:
  `collector.exe -voiptesterprobe-cli-exe .\bin\voiptesterprobe-cli.exe -voiptesterprobe-exe .\bin\voiptesterprobe.exe`.

**Technician run:** with a probe built with the server URL baked in
(`-ldflags "-X main.defaultServer=https://voiptest.axustechnologies.com"`), the
technician only needs the CODE: `voiptesterprobe-cli.exe -code AB12CD`, or just **double-click
`voiptesterprobe-cli.exe`** and paste the CODE when prompted.

**2. Create a test** (operator), e.g. 50 concurrent G.711 calls over UDP:

```bash
curl -X POST http://collector:8080/api/tests \
  -d '{"codec":"g711","channels":50,"transport":"udp","duration_sec":60,"ptime_ms":20}'
# -> {"code":"AB12CD", ...}

# Opus at 48 kbps, marked EF (DSCP 46):
curl -X POST http://collector:8080/api/tests \
  -d '{"codec":"opus","bitrate_kbps":48,"channels":20,"transport":"udp","duration_sec":60,"dscp":46}'
```

A test is **test-level** settings (`transport` udp/tcp, `duration_sec`, `dscp`
0–63, optional `thresholds`) plus one or more **profiles**. Each profile is a
codec + channel group: `codec` (`g711`/`g729`/`g722`/`opus`), `channels`,
`ptime_ms` (10/20/30), `bitrate_kbps` (Opus only). A **mixed** test simply lists
several profiles that run together:

```bash
curl -X POST http://collector:8080/api/tests -d '{
  "transport":"udp","duration_sec":60,"dscp":46,
  "profiles":[
    {"codec":"g711","channels":30,"ptime_ms":20},
    {"codec":"g729","channels":20,"ptime_ms":20}
  ]}'
```

The report then breaks results down **per profile** as well as overall. A
single-profile test may also use the flat shorthand
(`{"codec":"g711","channels":50,...}`) instead of a `profiles` list.

### Easiest: create it in the dashboard

Click **+ New test** on the dashboard to fill in transport/duration/DSCP,
add one or more profiles, and create the test — no curl. You get the CODE and,
when the collector was started with `-voiptesterprobe-exe`, a big **Download
voiptesterprobe.exe (ready to connect)** button. That download is **pre-bound to this
test**: the collector's URL and the CODE are baked into the .exe, so you just
send it to the technician and they run it — it connects and starts the test on
its own, then stays in the tray until reboot. No CODE to read out, nothing to
type. (A collapsed section still offers the console `voiptesterprobe-cli.exe` + copy-paste
command for anyone who prefers it.)

**3. Run the probe** inside the network under test:

```powershell
.\voiptesterprobe-cli.exe -server http://collector:8080 -code AB12CD
```

The probe prints the tiered report and writes `AB12CD-<timestamp>.{txt,json,csv}`.

### Resident GUI probe (`voiptesterprobe.exe`) — recommended for technicians

`voiptesterprobe.exe` is a single self-contained Windows app (same RTP engine as the
console probe, wrapped in a native GUI) meant to be **left running at a site**:

- **Zero-typing when downloaded from the dashboard** — if it was downloaded via
  the create screen's **Download voiptesterprobe.exe** button, the collector URL and the
  test CODE are baked into the download (a config trailer appended after the PE
  image, which also survives the browser renaming the file). On launch the probe
  fills both fields and **auto-connects** — the tech just runs it.
- **Simple GUI** — a Collector field (prefilled with the baked-in URL) and a
  **Test CODE** box. Absent an embedded CODE, the tech pastes the CODE the admin
  gives them and clicks **Run test** (or presses Enter). A marquee bar shows it's
  working; the probe's progress and the full report stream into the log pane.
  When it finishes it goes back to idle, **ready for the next CODE** — no relaunch
  between tests.
- **Stays running until reboot** — clicking the window's **X hides it to the
  system tray**, it does not quit. It keeps running there indefinitely.
- **Warn before it's closed** — the only way to actually exit is the tray icon's
  **Exit**, which asks for confirmation first (and warns harder if a test is
  mid-run).
- **Warn before a reboot** — the app registers a Windows *shutdown block*, so if
  someone tries to shut down or restart the PC, Windows shows its "this app is
  preventing shutdown" screen naming the probe and the reason. A standing or
  in-progress test is never killed silently by a reboot.
- Reports are written to a **`reports\` folder next to the .exe**; the
  **Open reports folder** button opens it.

Build it with the collector URL baked in so the tech never types a URL:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1 -Server https://voiptest.axustechnologies.com
# -> bin\voiptesterprobe.exe  (plus collector.exe and the console voiptesterprobe-cli.exe)
```

Hand the tech `voiptesterprobe.exe` and the CODE. That's it.

### One-shot convenience

The probe can create the test and run it in one go (handy for a single machine):

```powershell
.\voiptesterprobe-cli.exe -server http://collector:8080 -codec g729 -channels 20 -transport tcp -duration 30 -ptime 20
# create-mode flags also include -bitrate (Opus kbps) and -dscp (0–63), e.g.:
.\voiptesterprobe-cli.exe -server http://collector:8080 -codec opus -bitrate 48 -channels 20 -dscp 46
```

## Media & transport

Each channel is one bidirectional simulated call carried as **real RTP**
(RFC 3550): a proper 12-byte header (V/PT/seq/timestamp/SSRC), correct
payload types, and correctly sized synthetic payload. Per-packet sizing at the
IP layer (UDP, 20 ms ptime):

| Codec | PT | RTP clock | payload @20ms | + RTP/UDP/IP | bitrate/call |
| --- | --- | --- | --- | --- | --- |
| G.711 µ-law | 0 | 8 kHz | 160 B | 200 B | ~80 kbps |
| G.729 | 18 | 8 kHz | 20 B | 60 B | ~24 kbps |
| G.722 (wideband) | 9 | 8 kHz¹ | 160 B | 200 B | ~80 kbps |
| Opus (wideband) | 111 | 48 kHz | bitrate-dependent² | +40 B | configurable |

¹ G.722's RTP timestamp clock is 8 kHz by historical convention (RFC 3551
§4.5.2) even though it samples audio at 16 kHz. ² Opus payload scales with the
`bitrate_kbps` option (default 32 kbps → 80 B @20ms; e.g. `-bitrate 48`).

`ptime` is configurable (10/20/30 ms); payload scales accordingly.

### Codecs & the E-model scale

The tool uses the single **narrowband G.107 R-scale for every codec** so all
results are directly comparable. That scale cannot represent the perceptual
advantage of the two wideband codecs (G.722, Opus), so they are modeled as
transmission-transparent (Ie ≈ 0 — their MOS ceiling equals G.711's) and are
differentiated by loss robustness (Bpl) and by the **real bitrate/packet load**
they place on the network, which is what a capacity test measures. Their true
wideband MOS would be higher; this is a deliberate, documented simplification.

### QoS / DSCP marking

Set `dscp` (0–63; e.g. **46 = EF** for voice) to mark the RTP DiffServ code
point. Both sides mark their traffic: the probe marks what it sends and the
collector marks the echoes it returns, so QoS is exercised in both directions.

> **Windows caveat:** on Linux this genuinely marks packets. On **Windows** the
> `setsockopt` call typically succeeds but the OS **ignores** a user-set DSCP
> (since XP SP2 it requires the qWAVE API or a QoS Group Policy). A DSCP set on
> the Windows probe will usually leave packets best-effort. This is a Windows
> limitation, not a tool bug, and it is called out in the report header.

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

- **Per-direction (one-way)** — the collector measures the **forward** leg
  (client → collector) directly from the RTP it receives (loss from sequence
  gaps, RFC 3550 jitter, reorder/dup), keyed by SSRC. Combined with the client's
  round-trip receive count it yields clean per-leg **loss**: forward =
  sent − collector-received, return = collector-received − client-received. Shown
  in the report ("PER-DIRECTION" tier), the JSON/CSV, and the dashboard. Delay
  stays round-trip (no synced clocks), so no one-way delay is claimed per leg.
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
- **Live detail** (click a CODE) — real-time aggregate KPIs plus a
  **per-direction** (forward/return) card row.
- **Per-channel live table** — worst channel visible at a glance.
- **Live charts** — rolling loss %, jitter, and MOS over the test duration.
- **Compare** — tick two or more finished tests and hit **Compare** for a
  side-by-side table of config and results (codec, DSCP, loss, MOS, jitter, RTT,
  per-direction loss, bitrate) — e.g. G.711 vs G.729, or EF vs best-effort.

## Control API

| Method & path | Purpose |
| --- | --- |
| `POST /api/tests` | Create a test; returns CODE + media endpoint. |
| `GET /api/tests` | List all tests (summaries). |
| `GET /api/tests/{code}` | Test detail (JSON). |
| `DELETE /api/admin/tests/{code}` | Delete a test (any state): removes the live object + frees its media port, the in-memory history, and the persisted `<CODE>.json`. The dashboard's ✕ button on each list row calls this. Under `/api/admin/` so it stays SSO-protected (not on the open technician surface). |
| `POST /api/tests/{code}/claim` | Client claims a CODE (409 if already active). |
| `POST /api/tests/{code}/stats` | Client streams stats. |
| `GET /api/tests/{code}/stream` | SSE: live detail for one test. |
| `GET /api/stream` | SSE: live test list. |
| `GET /api/tests/{code}/report?format=` | `txt` (default), `json`, `csv`. |

## Design notes / limitations

- **One CODE = one client session.** The probe refuses a second concurrent run
  in-process; the server returns **409** to a second client claiming an active
  CODE.
- **Round-trip + per-direction.** RTT and the aggregate jitter are round-trip
  (measured on the echoed stream). Per-direction **loss** and forward **jitter**
  are also reported: the collector now measures the inbound (forward) stream per
  SSRC and the return leg is derived by combining counts. There is still no
  per-leg one-way *delay* — that needs synced clocks.
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
loss/delay/burstiness degradation, G.729 < G.711 ceiling), RFC 4571 framing,
per-codec sizing/clock (incl. Opus bitrate override), and the per-direction
(forward/return) loss decomposition.
