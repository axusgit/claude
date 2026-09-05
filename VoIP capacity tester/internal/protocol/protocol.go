// Package protocol defines the shared control-plane types and constants used by
// both the collector (server) and the probe (client). Keeping these in one
// place guarantees the wire format for the HTTP/JSON control API and the stats
// stream stay in lock-step between the two binaries.
package protocol

import (
	"crypto/rand"
	"math/big"
)

// Codec identifies the simulated voice codec. We never actually encode audio;
// we generate synthetic payload of the correct size, but the payload type and
// per-packet sizing are real (see internal/codec).
type Codec string

const (
	CodecG711 Codec = "g711" // ITU-T G.711 u-law, RTP payload type 0
	CodecG729 Codec = "g729" // ITU-T G.729,       RTP payload type 18
)

// Transport is chosen per test; every channel in the test uses it.
type Transport string

const (
	TransportUDP Transport = "udp" // standard RTP over UDP
	TransportTCP Transport = "tcp" // RTP framed over TCP (RFC 4571), one conn per channel
)

// TestState is the lifecycle of a test on the server.
type TestState string

const (
	StateCreated  TestState = "created"  // resources allocated, waiting for a client to claim
	StateClaimed  TestState = "claimed"  // a client has pulled config; media may start any moment
	StateRunning  TestState = "running"  // stats are flowing
	StateComplete TestState = "complete" // client posted final results
	StateExpired  TestState = "expired"  // timed out / never completed; resources freed
)

// Thresholds drive the per-parameter pass/fail verdict. All are configurable;
// DefaultThresholds provides the spec defaults.
type Thresholds struct {
	LossPct  float64 `json:"loss_pct"`  // max acceptable loss %, default 1.0
	JitterMs float64 `json:"jitter_ms"` // max acceptable mean jitter ms, default 30
	OneWayMs float64 `json:"oneway_ms"` // max acceptable one-way delay ms, default 150
	MOS      float64 `json:"mos"`       // min acceptable MOS, default 4.0
}

// DefaultThresholds returns the spec-default pass/fail limits.
func DefaultThresholds() Thresholds {
	return Thresholds{LossPct: 1.0, JitterMs: 30, OneWayMs: 150, MOS: 4.0}
}

// TestConfig fully describes a test run. It is created by the operator and
// echoed back to the client at claim time.
type TestConfig struct {
	Codec       Codec      `json:"codec"`
	Channels    int        `json:"channels"`
	Transport   Transport  `json:"transport"`
	DurationSec int        `json:"duration_sec"`
	PtimeMs     int        `json:"ptime_ms"` // 10, 20 or 30
	Thresholds  Thresholds `json:"thresholds"`
}

// MediaEndpoint tells the client where to send the RTP streams. A single media
// port per test is sufficient for both transports: for UDP the server echoes
// each datagram back to its source, and for TCP the client opens one connection
// per channel to the same listener. Per-channel isolation is maintained by the
// client (each channel has its own socket / connection and its own metrics),
// while per-test isolation on the server is by CODE + dedicated port.
type MediaEndpoint struct {
	Host      string    `json:"host"`
	Port      int       `json:"port"`
	Transport Transport `json:"transport"`
}

// CreateTestResponse is returned when an operator creates a test.
type CreateTestResponse struct {
	Code   string        `json:"code"`
	Config TestConfig    `json:"config"`
	Media  MediaEndpoint `json:"media"`
}

// ClaimRequest is sent by the client to take ownership of a CODE.
type ClaimRequest struct {
	ClientID string `json:"client_id"`
}

// ClaimResponse hands the client everything it needs to run the test.
type ClaimResponse struct {
	Code   string        `json:"code"`
	Config TestConfig    `json:"config"`
	Media  MediaEndpoint `json:"media"`
}

// ChannelStats is one channel's snapshot, computed by the client. The same
// struct is used for periodic live snapshots and for the final report, so the
// dashboard and the report share one shape.
type ChannelStats struct {
	Channel int `json:"channel"`

	// Volume / throughput
	PacketsExpected int64   `json:"packets_expected"`
	PacketsSent     int64   `json:"packets_sent"`
	PacketsRecv     int64   `json:"packets_recv"` // unique echoed packets received
	BytesRecv       int64   `json:"bytes_recv"`   // IP-layer bytes (estimate)
	BitrateKbps     float64 `json:"bitrate_kbps"`
	ExpectedKbps    float64 `json:"expected_kbps"`

	// Loss
	Lost         int64   `json:"lost"`
	LossPct      float64 `json:"loss_pct"`
	Reordered    int64   `json:"reordered"`
	Duplicates   int64   `json:"duplicates"`
	BurstCount   int64   `json:"burst_count"`   // loss runs of length >= 2
	IsolatedLoss int64   `json:"isolated_loss"` // single-packet losses
	LongestBurst int64   `json:"longest_burst"`
	BurstRatio   float64 `json:"burst_ratio"` // mean loss-run length (>=1); fed to the E-model

	// Jitter (RFC 3550)
	JitterMs    float64 `json:"jitter_ms"`     // smoothed interarrival jitter J
	JitterMaxMs float64 `json:"jitter_max_ms"` // peak
	JitterP95Ms float64 `json:"jitter_p95_ms"`

	// Delay
	RTTMinMs        float64 `json:"rtt_min_ms"`
	RTTMeanMs       float64 `json:"rtt_mean_ms"`
	RTTMaxMs        float64 `json:"rtt_max_ms"`
	RTTP95Ms        float64 `json:"rtt_p95_ms"`
	OneWayMs        float64 `json:"oneway_ms"`
	OneWayEstimated bool    `json:"oneway_estimated"` // true when derived as RTT/2

	// Derived quality (ITU-T G.107 E-model)
	RFactor float64 `json:"r_factor"`
	MOS     float64 `json:"mos"`

	// Verdict
	Pass        bool     `json:"pass"`
	FailReasons []string `json:"fail_reasons,omitempty"`
}

// StatsReport is one POST from the client to /api/tests/{code}/stats.
type StatsReport struct {
	Code       string         `json:"code"`
	ClientID   string         `json:"client_id"`
	ElapsedSec float64        `json:"elapsed_sec"`
	Final      bool           `json:"final"`
	Channels   []ChannelStats `json:"channels"`
}

// Aggregate summarizes all channels of a test. Computed on the server from the
// most recent snapshot so the dashboard and final report agree.
type Aggregate struct {
	Channels        int   `json:"channels"`
	PacketsExpected int64 `json:"packets_expected"`
	PacketsSent     int64 `json:"packets_sent"`
	PacketsRecv     int64 `json:"packets_recv"`
	BytesRecv       int64 `json:"bytes_recv"`

	LossPct      float64 `json:"loss_pct"`
	TotalLost    int64   `json:"total_lost"`
	Reordered    int64   `json:"reordered"`
	Duplicates   int64   `json:"duplicates"`
	BurstCount   int64   `json:"burst_count"`
	IsolatedLoss int64   `json:"isolated_loss"`
	LongestBurst int64   `json:"longest_burst"`

	JitterMeanMs float64 `json:"jitter_mean_ms"`
	JitterMaxMs  float64 `json:"jitter_max_ms"`
	JitterP95Ms  float64 `json:"jitter_p95_ms"`

	RTTMinMs  float64 `json:"rtt_min_ms"`
	RTTMeanMs float64 `json:"rtt_mean_ms"`
	RTTMaxMs  float64 `json:"rtt_max_ms"`
	RTTP95Ms  float64 `json:"rtt_p95_ms"`
	OneWayMs  float64 `json:"oneway_ms"`

	BitrateKbps  float64 `json:"bitrate_kbps"`
	ExpectedKbps float64 `json:"expected_kbps"`

	RFactorMean float64 `json:"r_factor_mean"`
	MOSMean     float64 `json:"mos_mean"`
	MOSMin      float64 `json:"mos_min"`
	WorstChan   int     `json:"worst_channel"` // channel index with lowest MOS
	Pass        bool    `json:"pass"`
}

// TestSummary is the compact row used by the test-list view.
type TestSummary struct {
	Code       string     `json:"code"`
	State      TestState  `json:"state"`
	Codec      Codec      `json:"codec"`
	Transport  Transport  `json:"transport"`
	Channels   int        `json:"channels"`
	PtimeMs    int        `json:"ptime_ms"`
	ClientID   string     `json:"client_id,omitempty"`
	ClientIP   string     `json:"client_ip,omitempty"`
	MediaPort  int        `json:"media_port"`
	ElapsedSec float64    `json:"elapsed_sec"`
	RemainSec  float64    `json:"remain_sec"`
	MOS        float64    `json:"mos"`
	LossPct    float64    `json:"loss_pct"`
	Pass       bool       `json:"pass"`
}

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no ambiguous 0/O/1/I

// GenerateCode returns a 6-character unambiguous alphanumeric test code.
func GenerateCode() string {
	b := make([]byte, 6)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			// crypto/rand failing is catastrophic; fall back to a fixed char so
			// the caller still gets a well-formed (if less random) code.
			b[i] = codeAlphabet[0]
			continue
		}
		b[i] = codeAlphabet[n.Int64()]
	}
	return string(b)
}
