package server

import (
	"bufio"
	"encoding/json"
	"net"
	"sync"
	"syscall"
	"time"

	"voiptest/internal/metrics"
	"voiptest/internal/protocol"
	"voiptest/internal/qos"
	"voiptest/internal/report"
	"voiptest/internal/rtp"
)

// historyCap bounds the number of time-series points kept for the live charts.
const historyCap = 1800 // e.g. 30 min at 1 Hz

// point is one sample on the rolling live charts.
type point struct {
	T      float64 `json:"t"`
	Loss   float64 `json:"loss"`
	Jitter float64 `json:"jitter"`
	MOS    float64 `json:"mos"`
}

// Test is one isolated test run, keyed by CODE. It owns its own media listener
// (a single port per test), its own stats bucket, and its own set of SSE
// subscribers, so multiple tests run fully independently on one server.
type Test struct {
	mu sync.Mutex

	Code   string
	Config protocol.TestConfig
	State  protocol.TestState

	CreatedAt   time.Time
	ClaimedAt   time.Time
	StartedAt   time.Time
	CompletedAt time.Time
	lastStats   time.Time

	ClientID  string
	ClientIP  string
	MediaHost string // advertised to the client at claim time

	// Media echo endpoint (one per test).
	mediaPort int
	udpConn   *net.UDPConn
	tcpLn     net.Listener
	closeOnce sync.Once

	// Latest results.
	channels   []protocol.ChannelStats
	agg        protocol.Aggregate
	history    []point
	elapsedSec float64

	// Forward-path (client -> collector) measurement, one accumulator per SSRC,
	// fed on the echo path. Combined with the client's posted round-trip stats it
	// yields genuine per-direction loss/jitter. Guarded by fwdMu.
	fwdMu sync.Mutex
	fwd   map[uint32]*metrics.Channel

	// SSE detail subscribers.
	subs map[chan []byte]struct{}
}

func newTest(code string, cfg protocol.TestConfig) *Test {
	return &Test{
		Code:      code,
		Config:    cfg,
		State:     protocol.StateCreated,
		CreatedAt: time.Now(),
		fwd:       make(map[uint32]*metrics.Channel),
		subs:      make(map[chan []byte]struct{}),
	}
}

// forwardChannel returns (creating on first use) the forward-path accumulator
// for an SSRC. The index is filled in later from the client's channel<->SSRC
// mapping; it is irrelevant to the receive-only measurement.
func (t *Test) forwardChannel(ssrc uint32) *metrics.Channel {
	t.fwdMu.Lock()
	defer t.fwdMu.Unlock()
	c := t.fwd[ssrc]
	if c == nil {
		c = metrics.NewChannel(0, t.Config)
		t.fwd[ssrc] = c
	}
	return c
}

// observeForward feeds one received media packet into the forward-path
// accumulator for its SSRC. sendTime is passed as 0 so no (meaningless,
// unsynced) RTT is accumulated on the collector — only loss/jitter/ordering.
func (t *Test) observeForward(pkt []byte, now int64) {
	hdr, ok := rtp.ParseHeader(pkt)
	if !ok {
		return
	}
	t.forwardChannel(hdr.SSRC).OnReceive(hdr.Sequence, hdr.Timestamp, 0, now)
}

// startMedia allocates and starts the echo listener for this test. bind is the
// interface to bind on ("" = all). A single port serves every channel: for UDP
// each datagram is echoed to its source; for TCP each channel opens its own
// RFC 4571-framed connection to this listener.
func (t *Test) startMedia(bind string) error {
	switch t.Config.Transport {
	case protocol.TransportTCP:
		ln, err := net.Listen("tcp", net.JoinHostPort(bind, "0"))
		if err != nil {
			return err
		}
		t.tcpLn = ln
		t.mediaPort = ln.Addr().(*net.TCPAddr).Port
		go t.acceptTCP(ln)
	default:
		addr, err := net.ResolveUDPAddr("udp", net.JoinHostPort(bind, "0"))
		if err != nil {
			return err
		}
		conn, err := net.ListenUDP("udp", addr)
		if err != nil {
			return err
		}
		t.udpConn = conn
		t.mediaPort = conn.LocalAddr().(*net.UDPAddr).Port
		markSockDSCP(conn, t.Config.DSCP) // mark the echoes we send back
		go t.echoUDP(conn)
	}
	return nil
}

// echoUDP reflects every datagram back to its sender unchanged, acting as the
// far-end RTP peer so the client can measure the round trip. Before echoing it
// records the packet on the forward (client -> collector) leg.
func (t *Test) echoUDP(conn *net.UDPConn) {
	buf := make([]byte, 2048)
	for {
		n, src, err := conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		t.observeForward(buf[:n], time.Now().UnixNano())
		_, _ = conn.WriteToUDP(buf[:n], src)
	}
}

func (t *Test) acceptTCP(ln net.Listener) {
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		markSockDSCP(c, t.Config.DSCP)
		go t.echoTCPConn(c)
	}
}

// echoTCPConn deframes RTP packets (RFC 4571), records each on the forward leg,
// and writes them straight back, preserving packet boundaries.
func (t *Test) echoTCPConn(c net.Conn) {
	defer c.Close()
	br := bufio.NewReader(c)
	bw := bufio.NewWriter(c)
	buf := make([]byte, 2048)
	for {
		n, err := rtp.ReadFramed(br, buf)
		if err != nil {
			return
		}
		t.observeForward(buf[:n], time.Now().UnixNano())
		if err := rtp.WriteFramed(bw, buf[:n]); err != nil {
			return
		}
		if err := bw.Flush(); err != nil {
			return
		}
	}
}

// markSockDSCP applies a DSCP to a media socket's outgoing packets, best effort.
func markSockDSCP(c any, dscp int) {
	if dscp <= 0 {
		return
	}
	sc, ok := c.(interface {
		SyscallConn() (syscall.RawConn, error)
	})
	if !ok {
		return
	}
	if rc, err := sc.SyscallConn(); err == nil {
		_ = qos.SetDSCP(rc, dscp)
	}
}

func (t *Test) closeMedia() {
	t.closeOnce.Do(func() {
		if t.udpConn != nil {
			_ = t.udpConn.Close()
		}
		if t.tcpLn != nil {
			_ = t.tcpLn.Close()
		}
	})
}

// applyStats records a stats snapshot from the client and recomputes the
// aggregate and history. Returns the JSON detail payload to broadcast.
func (t *Test) applyStats(rep protocol.StatsReport) []byte {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	t.lastStats = now
	if t.State == protocol.StateClaimed || t.State == protocol.StateCreated {
		t.State = protocol.StateRunning
		if t.StartedAt.IsZero() {
			t.StartedAt = now
		}
	}
	t.channels = rep.Channels
	t.elapsedSec = rep.ElapsedSec
	t.agg = metrics.Aggregate(rep.Channels)

	t.history = append(t.history, point{
		T:      round1(rep.ElapsedSec),
		Loss:   t.agg.LossPct,
		Jitter: t.agg.JitterMeanMs,
		MOS:    t.agg.MOSMean,
	})
	if len(t.history) > historyCap {
		t.history = t.history[len(t.history)-historyCap:]
	}

	if rep.Final {
		t.State = protocol.StateComplete
		t.CompletedAt = now
	}
	return t.detailJSONLocked()
}

// forwardSummary returns the collector-measured forward-leg summary for an
// SSRC, or a zero value if nothing has been received for it yet.
func (t *Test) forwardSummary(ssrc uint32) metrics.RecvSummary {
	t.fwdMu.Lock()
	c := t.fwd[ssrc]
	t.fwdMu.Unlock()
	if c == nil {
		return metrics.RecvSummary{}
	}
	return c.RecvSummary()
}

// directionStatsLocked builds per-channel and aggregate one-way stats for both
// legs by combining the collector's forward measurement with the client's
// posted round-trip stats. Caller holds t.mu (t.channels is read); fwdMu is
// taken internally. Loss is count-based: forward = sent−(collector recv),
// return = (collector recv)−(client round-trip recv).
func (t *Test) directionStatsLocked() (fwd, ret []protocol.DirectionStats, fAgg, rAgg protocol.DirectionAggregate) {
	fAgg.Direction = "forward"
	rAgg.Direction = "return"
	var fJitSum float64
	var fJitN int
	for _, cs := range t.channels {
		sum := t.forwardSummary(cs.SSRC)

		// Forward leg: client -> collector.
		fRecv := sum.Recv
		fLost := cs.PacketsSent - fRecv
		if fLost < 0 {
			fLost = 0
		}
		var fPct float64
		if cs.PacketsSent > 0 {
			fPct = 100 * float64(fLost) / float64(cs.PacketsSent)
		}
		fwd = append(fwd, protocol.DirectionStats{
			Channel: cs.Channel, SSRC: cs.SSRC, Direction: "forward",
			Recv: fRecv, Lost: fLost, LossPct: round3(fPct),
			Reordered: sum.Reordered, Duplicates: sum.Duplicates,
			JitterMs: sum.JitterMs, JitterMaxMs: sum.JitterMaxMs,
		})

		// Return leg: collector -> client. Of the fRecv packets the collector
		// echoed, the client uniquely received cs.PacketsRecv.
		rRecv := cs.PacketsRecv
		rLost := fRecv - rRecv
		if rLost < 0 {
			rLost = 0
		}
		var rPct float64
		if fRecv > 0 {
			rPct = 100 * float64(rLost) / float64(fRecv)
		}
		ret = append(ret, protocol.DirectionStats{
			Channel: cs.Channel, SSRC: cs.SSRC, Direction: "return",
			Recv: rRecv, Lost: rLost, LossPct: round3(rPct),
		})

		fAgg.Recv += fRecv
		fAgg.Lost += fLost
		fAgg.Reordered += sum.Reordered
		fAgg.Duplicates += sum.Duplicates
		if sum.JitterMs > 0 {
			fJitSum += sum.JitterMs
			fJitN++
		}
		if sum.JitterMaxMs > fAgg.JitterMaxMs {
			fAgg.JitterMaxMs = sum.JitterMaxMs
		}
		rAgg.Recv += rRecv
		rAgg.Lost += rLost
	}
	if d := fAgg.Recv + fAgg.Lost; d > 0 {
		fAgg.LossPct = round3(100 * float64(fAgg.Lost) / float64(d))
	}
	if d := rAgg.Recv + rAgg.Lost; d > 0 {
		rAgg.LossPct = round3(100 * float64(rAgg.Lost) / float64(d))
	}
	if fJitN > 0 {
		fAgg.JitterMeanMs = round3(fJitSum / float64(fJitN))
	}
	return fwd, ret, fAgg, rAgg
}

// detailJSON returns the live-detail payload (must not hold the lock).
func (t *Test) detailJSON() []byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.detailJSONLocked()
}

func (t *Test) detailJSONLocked() []byte {
	fwd, ret, fAgg, rAgg := t.directionStatsLocked()
	payload := struct {
		Code       string                     `json:"code"`
		State      protocol.TestState         `json:"state"`
		Config     protocol.TestConfig        `json:"config"`
		ClientID   string                     `json:"client_id"`
		ClientIP   string                     `json:"client_ip"`
		MediaPort  int                        `json:"media_port"`
		Elapsed    float64                    `json:"elapsed_sec"`
		Remain     float64                    `json:"remain_sec"`
		Aggregate  protocol.Aggregate         `json:"aggregate"`
		Channels   []protocol.ChannelStats    `json:"channels"`
		Forward    []protocol.DirectionStats  `json:"forward"`
		Return     []protocol.DirectionStats  `json:"return"`
		ForwardAgg protocol.DirectionAggregate `json:"forward_agg"`
		ReturnAgg  protocol.DirectionAggregate `json:"return_agg"`
		History    []point                    `json:"history"`
	}{
		Code:       t.Code,
		State:      t.State,
		Config:     t.Config,
		ClientID:   t.ClientID,
		ClientIP:   t.ClientIP,
		MediaPort:  t.mediaPort,
		Elapsed:    round1(t.elapsedSec),
		Remain:     t.remainLocked(),
		Aggregate:  t.agg,
		Channels:   t.channels,
		Forward:    fwd,
		Return:     ret,
		ForwardAgg: fAgg,
		ReturnAgg:  rAgg,
		History:    t.history,
	}
	b, _ := json.Marshal(payload)
	return b
}

func (t *Test) remainLocked() float64 {
	if t.State == protocol.StateComplete || t.State == protocol.StateExpired {
		return 0
	}
	r := float64(t.Config.DurationSec) - t.elapsedSec
	if r < 0 {
		return 0
	}
	return round1(r)
}

// summary produces the compact row for the test list.
func (t *Test) summary() protocol.TestSummary {
	t.mu.Lock()
	defer t.mu.Unlock()
	return protocol.TestSummary{
		Code:       t.Code,
		State:      t.State,
		Codec:      t.Config.Codec,
		Transport:  t.Config.Transport,
		Channels:   t.Config.Channels,
		PtimeMs:    t.Config.PtimeMs,
		ClientID:   t.ClientID,
		ClientIP:   t.ClientIP,
		MediaPort:  t.mediaPort,
		ElapsedSec: round1(t.elapsedSec),
		RemainSec:  t.remainLocked(),
		MOS:        t.agg.MOSMean,
		LossPct:    t.agg.LossPct,
		Pass:       t.agg.Pass,
	}
}

// result assembles the final report Result from stored state.
func (t *Test) result() report.Result {
	t.mu.Lock()
	defer t.mu.Unlock()
	gen := t.CompletedAt
	if gen.IsZero() {
		gen = time.Now()
	}
	fwd, ret, fAgg, rAgg := t.directionStatsLocked()
	return report.Result{
		Code:        t.Code,
		GeneratedAt: gen,
		ClientID:    t.ClientID,
		ClientIP:    t.ClientIP,
		Config:      t.Config,
		Aggregate:   t.agg,
		Channels:    t.channels,
		Forward:     fwd,
		Return:      ret,
		ForwardAgg:  fAgg,
		ReturnAgg:   rAgg,
	}
}

// subscribe registers an SSE detail subscriber.
func (t *Test) subscribe() chan []byte {
	ch := make(chan []byte, 4)
	t.mu.Lock()
	t.subs[ch] = struct{}{}
	t.mu.Unlock()
	return ch
}

func (t *Test) unsubscribe(ch chan []byte) {
	t.mu.Lock()
	delete(t.subs, ch)
	t.mu.Unlock()
	close(ch)
}

func (t *Test) broadcast(msg []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for ch := range t.subs {
		select {
		case ch <- msg:
		default: // drop for slow consumers; next update supersedes it
		}
	}
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

func round3(v float64) float64 {
	return float64(int64(v*1000+0.5)) / 1000
}
