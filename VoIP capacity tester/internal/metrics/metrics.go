// Package metrics accumulates per-channel measurements from the echoed RTP
// stream and produces protocol.ChannelStats snapshots.
//
// Measurement model: the client sends RTP to the collector, which echoes each
// packet back unchanged. The client measures on the returned stream, so all
// numbers here describe the ROUND-TRIP path (client -> collector -> client):
//
//   - RTT is measured directly from the send time embedded in each payload.
//   - One-way delay is estimated as RTT/2 and labelled an estimate (clocks are
//     not assumed to be NTP-synced).
//   - Jitter (RFC 3550), loss (sequence gaps), reordering and duplicates are all
//     computed on the echoed stream, which carries the client's original RTP
//     headers.
//
// A Channel is written by exactly one receiver goroutine and read (via Snapshot)
// by the reporting goroutine, so a mutex guards the shared state.
package metrics

import (
	"math"
	"math/rand"
	"sort"
	"sync"

	"voiptest/internal/codec"
	"voiptest/internal/emodel"
	"voiptest/internal/protocol"
)

// RFC 3550 sequence-tracking constants (Appendix A.1).
const (
	maxDropout  = 3000
	maxMisorder = 100
)

// Channel accumulates measurements for a single simulated call.
type Channel struct {
	mu sync.Mutex

	index      int
	ssrc       uint32
	ci         codec.Info
	cfg        protocol.TestConfig
	ipBytesPkt int // on-wire bytes per packet at IP layer

	// Send-side counters (updated by the sender goroutine via IncSent).
	sent      int64
	sentMu    sync.Mutex

	// Receive-side counters.
	recv      int64 // unique packets received
	dupes     int64
	reordered int64
	bytesRecv int64

	// Extended sequence-number tracking.
	seqInit      bool
	maxSeq       uint16
	cycles       uint64
	baseExt      uint64
	baseSet      bool
	expectedNext uint64
	seen         map[uint64]struct{}

	// Loss-run (burst) accounting from detected gaps.
	numRuns      int64
	sumRunLen    int64
	burstRuns    int64
	isolatedLoss int64
	longestBurst int64

	// Jitter (RFC 3550).
	jitterInit  bool
	lastTransit int64
	jitter      float64 // smoothed, in RTP timestamp units
	jitterMaxMs float64
	jitterSamp  []float64 // smoothed jitter samples (ms) for p95

	// RTT samples (ms).
	rtt []float64
}

// NewChannel creates an accumulator for one channel.
func NewChannel(index int, cfg protocol.TestConfig) *Channel {
	ci := codec.ForConfig(cfg)
	payload := ci.PayloadBytes(cfg.PtimeMs)
	return &Channel{
		index:      index,
		ssrc:       rand.Uint32(),
		ci:         ci,
		cfg:        cfg,
		ipBytesPkt: codec.IPBytesPerPacket(payload, cfg.Transport),
		seen:       make(map[uint64]struct{}, 4096),
	}
}

// SSRC returns the RTP SSRC assigned to this channel.
func (c *Channel) SSRC() uint32 { return c.ssrc }

// RecvSummary is a receive-only view of a channel, used by the collector to
// report the forward leg (client -> collector) it measures on the echo path.
type RecvSummary struct {
	Recv        int64
	Lost        int64 // from RTP sequence gaps, net of late (reordered) recoveries
	Reordered   int64
	Duplicates  int64
	JitterMs    float64
	JitterMaxMs float64
}

// RecvSummary returns the receive-side measurements accumulated so far. Loss is
// computed purely from RTP sequence numbers (gap-based), so it is valid for a
// one-directional receiver that has no send-count to compare against.
func (c *Channel) RecvSummary() RecvSummary {
	c.mu.Lock()
	defer c.mu.Unlock()
	lost := c.sumRunLen - c.reordered
	if lost < 0 {
		lost = 0
	}
	return RecvSummary{
		Recv:        c.recv,
		Lost:        lost,
		Reordered:   c.reordered,
		Duplicates:  c.dupes,
		JitterMs:    round3(c.jitter / float64(c.ci.ClockRate) * 1000.0),
		JitterMaxMs: round3(c.jitterMaxMs),
	}
}

// IncSent records that the sender transmitted one packet.
func (c *Channel) IncSent() {
	c.sentMu.Lock()
	c.sent++
	c.sentMu.Unlock()
}

func (c *Channel) sentCount() int64 {
	c.sentMu.Lock()
	defer c.sentMu.Unlock()
	return c.sent
}

// OnReceive feeds one echoed RTP packet into the accumulator.
//   seq, tsRTP: the RTP header sequence number and timestamp (client's own).
//   sendTimeNanos: the send time read from the payload (0 if unavailable).
//   nowNanos: monotonic receive time in nanoseconds.
func (c *Channel) OnReceive(seq uint16, tsRTP uint32, sendTimeNanos, nowNanos int64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.bytesRecv += int64(c.ipBytesPkt)

	// RTT from the embedded send time.
	if sendTimeNanos > 0 {
		rttMs := float64(nowNanos-sendTimeNanos) / 1e6
		if rttMs >= 0 {
			c.rtt = append(c.rtt, rttMs)
		}
	}

	c.updateJitter(tsRTP, nowNanos)

	ext := c.extend(seq)

	if _, dup := c.seen[ext]; dup {
		c.dupes++
		return
	}
	c.seen[ext] = struct{}{}
	c.recv++

	if !c.baseSet {
		c.baseSet = true
		c.baseExt = ext
		c.expectedNext = ext + 1
		return
	}

	switch {
	case ext == c.expectedNext:
		c.expectedNext++
	case ext > c.expectedNext:
		gap := int64(ext - c.expectedNext)
		c.recordGap(gap)
		c.expectedNext = ext + 1
	default:
		// ext < expectedNext: a late (reordered) packet that fills a hole we
		// previously counted as missing. It is recovered loss.
		c.reordered++
	}
}

// extend converts a 16-bit sequence number to a 64-bit extended one, tracking
// wraparound per RFC 3550 Appendix A.1.
func (c *Channel) extend(seq uint16) uint64 {
	if !c.seqInit {
		c.seqInit = true
		c.maxSeq = seq
		return uint64(seq)
	}
	udelta := seq - c.maxSeq
	if udelta < maxDropout {
		if seq < c.maxSeq { // wrapped
			c.cycles += 1 << 16
		}
		c.maxSeq = seq
	} else if udelta <= 65535-maxMisorder {
		// Large forward jump; treat as a new reference point.
		c.maxSeq = seq
	}
	return c.cycles + uint64(seq)
}

// recordGap classifies a run of consecutive missing packets.
func (c *Channel) recordGap(gap int64) {
	if gap <= 0 {
		return
	}
	c.numRuns++
	c.sumRunLen += gap
	if gap == 1 {
		c.isolatedLoss++
	} else {
		c.burstRuns++
	}
	if gap > c.longestBurst {
		c.longestBurst = gap
	}
}

// updateJitter applies the RFC 3550 interarrival jitter estimate.
func (c *Channel) updateJitter(tsRTP uint32, nowNanos int64) {
	nsPerTick := int64(1_000_000_000 / c.ci.ClockRate)
	arrival := uint32(nowNanos / nsPerTick) // RTP timestamp units, wraps naturally
	transit := int64(arrival) - int64(tsRTP)
	if c.jitterInit {
		d := transit - c.lastTransit
		if d < 0 {
			d = -d
		}
		c.jitter += (float64(d) - c.jitter) / 16.0
		jms := c.jitter / float64(c.ci.ClockRate) * 1000.0
		if jms > c.jitterMaxMs {
			c.jitterMaxMs = jms
		}
		c.jitterSamp = append(c.jitterSamp, jms)
	} else {
		c.jitterInit = true
	}
	c.lastTransit = transit
}

// percentile returns the p-th percentile (p in 0..1) of a copy of xs.
func percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := make([]float64, len(xs))
	copy(s, xs)
	sort.Float64s(s)
	idx := int(math.Ceil(p*float64(len(s)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(s) {
		idx = len(s) - 1
	}
	return s[idx]
}

func meanMinMax(xs []float64) (mean, min, max float64) {
	if len(xs) == 0 {
		return 0, 0, 0
	}
	min = xs[0]
	max = xs[0]
	var sum float64
	for _, v := range xs {
		sum += v
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	return sum / float64(len(xs)), min, max
}

// Snapshot computes the current per-channel stats. elapsedSec is the time the
// channel has been running, used to derive expected packet count and bitrate.
func (c *Channel) Snapshot(elapsedSec float64) protocol.ChannelStats {
	c.mu.Lock()
	defer c.mu.Unlock()

	payload := c.ci.PayloadBytes(c.cfg.PtimeMs)
	pps := codec.PacketsPerSec(c.cfg.PtimeMs)

	// Expected packets across the round trip = what we've sent (each sent packet
	// should come back exactly once). Using sent (not a time estimate) keeps loss
	// honest even if the sender is pacing imperfectly.
	sent := c.sentCount()
	expected := sent
	if expected < c.recv {
		expected = c.recv
	}

	lost := expected - c.recv
	if lost < 0 {
		lost = 0
	}
	var lossPct float64
	if expected > 0 {
		lossPct = 100 * float64(lost) / float64(expected)
	}

	// Burst ratio = mean loss-run length (>= 1). If no runs recorded, random.
	burstR := 1.0
	if c.numRuns > 0 {
		burstR = float64(c.sumRunLen) / float64(c.numRuns)
		if burstR < 1 {
			burstR = 1
		}
	}

	rttMean, rttMin, rttMax := meanMinMax(c.rtt)
	rttP95 := percentile(c.rtt, 0.95)
	oneWay := rttMean / 2.0

	jitterMean := c.jitter / float64(c.ci.ClockRate) * 1000.0
	jitterP95 := percentile(c.jitterSamp, 0.95)

	var bitrate float64
	if elapsedSec > 0 {
		bitrate = float64(c.bytesRecv) * 8 / 1000.0 / elapsedSec
	}
	expectedKbps := codec.ExpectedKbps(payload, c.cfg.PtimeMs, c.cfg.Transport)

	r := emodel.R(oneWay, lossPct, burstR, c.ci.Ie, c.ci.Bpl)
	mos := emodel.MOS(r)

	st := protocol.ChannelStats{
		Channel:         c.index,
		SSRC:            c.ssrc,
		PacketsExpected: int64(math.Round(elapsedSec * pps)),
		PacketsSent:     sent,
		PacketsRecv:     c.recv,
		BytesRecv:       c.bytesRecv,
		BitrateKbps:     round1(bitrate),
		ExpectedKbps:    round1(expectedKbps),

		Lost:         lost,
		LossPct:      round3(lossPct),
		Reordered:    c.reordered,
		Duplicates:   c.dupes,
		BurstCount:   c.burstRuns,
		IsolatedLoss: c.isolatedLoss,
		LongestBurst: c.longestBurst,
		BurstRatio:   round2(burstR),

		JitterMs:    round3(jitterMean),
		JitterMaxMs: round3(c.jitterMaxMs),
		JitterP95Ms: round3(jitterP95),

		RTTMinMs:        round3(rttMin),
		RTTMeanMs:       round3(rttMean),
		RTTMaxMs:        round3(rttMax),
		RTTP95Ms:        round3(rttP95),
		OneWayMs:        round3(oneWay),
		OneWayEstimated: true,

		RFactor: round2(r),
		MOS:     round3(mos),
	}
	st.Pass, st.FailReasons = verdict(st, c.cfg.Thresholds)
	return st
}

func verdict(s protocol.ChannelStats, t protocol.Thresholds) (bool, []string) {
	var reasons []string
	if s.LossPct >= t.LossPct {
		reasons = append(reasons, "loss")
	}
	if s.JitterMs >= t.JitterMs {
		reasons = append(reasons, "jitter")
	}
	if s.OneWayMs >= t.OneWayMs {
		reasons = append(reasons, "delay")
	}
	if s.MOS < t.MOS {
		reasons = append(reasons, "mos")
	}
	return len(reasons) == 0, reasons
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// Aggregate combines per-channel snapshots into an overall summary. It is used
// by both the live dashboard and the final report.
func Aggregate(chans []protocol.ChannelStats) protocol.Aggregate {
	agg := protocol.Aggregate{Channels: len(chans), Pass: true, MOSMin: math.MaxFloat64}
	if len(chans) == 0 {
		agg.MOSMin = 0
		return agg
	}

	var (
		jitterSum, rttSum, oneWaySum, rSum, mosSum float64
		rttMinAll                                  = math.MaxFloat64
	)
	agg.RTTMinMs = math.MaxFloat64
	worstMOS := math.MaxFloat64

	for _, c := range chans {
		agg.PacketsExpected += c.PacketsExpected
		agg.PacketsSent += c.PacketsSent
		agg.PacketsRecv += c.PacketsRecv
		agg.BytesRecv += c.BytesRecv
		agg.TotalLost += c.Lost
		agg.Reordered += c.Reordered
		agg.Duplicates += c.Duplicates
		agg.BurstCount += c.BurstCount
		agg.IsolatedLoss += c.IsolatedLoss
		if c.LongestBurst > agg.LongestBurst {
			agg.LongestBurst = c.LongestBurst
		}

		jitterSum += c.JitterMs
		if c.JitterMaxMs > agg.JitterMaxMs {
			agg.JitterMaxMs = c.JitterMaxMs
		}
		if c.JitterP95Ms > agg.JitterP95Ms {
			agg.JitterP95Ms = c.JitterP95Ms
		}

		rttSum += c.RTTMeanMs
		if c.RTTMinMs < rttMinAll && c.RTTMinMs > 0 {
			rttMinAll = c.RTTMinMs
		}
		if c.RTTMaxMs > agg.RTTMaxMs {
			agg.RTTMaxMs = c.RTTMaxMs
		}
		if c.RTTP95Ms > agg.RTTP95Ms {
			agg.RTTP95Ms = c.RTTP95Ms
		}
		oneWaySum += c.OneWayMs

		agg.BitrateKbps += c.BitrateKbps
		agg.ExpectedKbps += c.ExpectedKbps

		rSum += c.RFactor
		mosSum += c.MOS
		if c.MOS < agg.MOSMin {
			agg.MOSMin = c.MOS
		}
		if c.MOS < worstMOS {
			worstMOS = c.MOS
			agg.WorstChan = c.Channel
		}
		if !c.Pass {
			agg.Pass = false
		}
	}

	n := float64(len(chans))
	// Overall loss is based on received vs (received + lost) across all channels.
	totalExpected := agg.PacketsRecv + agg.TotalLost
	if totalExpected > 0 {
		agg.LossPct = round3(100 * float64(agg.TotalLost) / float64(totalExpected))
	}

	agg.JitterMeanMs = round3(jitterSum / n)
	agg.RTTMeanMs = round3(rttSum / n)
	if rttMinAll == math.MaxFloat64 {
		rttMinAll = 0
	}
	agg.RTTMinMs = round3(rttMinAll)
	agg.OneWayMs = round3(oneWaySum / n)
	agg.BitrateKbps = round1(agg.BitrateKbps)
	agg.ExpectedKbps = round1(agg.ExpectedKbps)
	agg.RFactorMean = round2(rSum / n)
	agg.MOSMean = round3(mosSum / n)
	agg.MOSMin = round3(agg.MOSMin)
	return agg
}
