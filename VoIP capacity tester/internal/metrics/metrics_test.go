package metrics

import (
	"testing"

	"voiptest/internal/protocol"
)

func testCfg() protocol.TestConfig {
	return protocol.TestConfig{
		Codec:       protocol.CodecG711,
		Channels:    1,
		Transport:   protocol.TransportUDP,
		DurationSec: 1,
		PtimeMs:     20,
		Thresholds:  protocol.DefaultThresholds(),
	}
}

// feed simulates the sender transmitting seqs [0,total) and the receiver getting
// only the ones in recvOrder (which may include gaps, dups, and reordering).
func feed(c *Channel, total int, recvOrder []int) {
	for i := 0; i < total; i++ {
		c.IncSent()
	}
	base := int64(1_000_000_000) // 1s in ns
	for _, s := range recvOrder {
		seq := uint16(s)
		ts := uint32(s) * 160 // 20ms * 8kHz
		now := base + int64(s)*20_000_000
		send := now - 5_000_000 // fixed 5ms RTT
		c.OnReceive(seq, ts, send, now)
	}
}

func TestLossBurstIsolated(t *testing.T) {
	c := NewChannel(0, testCfg())
	// Sent 20 (0..19). Drop 5 (isolated) and 10,11,12 (burst of 3).
	var recv []int
	for i := 0; i < 20; i++ {
		if i == 5 || i == 10 || i == 11 || i == 12 {
			continue
		}
		recv = append(recv, i)
	}
	feed(c, 20, recv)
	s := c.Snapshot(1.0)

	if s.Lost != 4 {
		t.Errorf("Lost = %d, want 4", s.Lost)
	}
	if s.LossPct != 20 {
		t.Errorf("LossPct = %v, want 20", s.LossPct)
	}
	if s.IsolatedLoss != 1 {
		t.Errorf("IsolatedLoss = %d, want 1", s.IsolatedLoss)
	}
	if s.BurstCount != 1 {
		t.Errorf("BurstCount = %d, want 1", s.BurstCount)
	}
	if s.LongestBurst != 3 {
		t.Errorf("LongestBurst = %d, want 3", s.LongestBurst)
	}
	// mean run length = (1 + 3) / 2 runs = 2.0
	if s.BurstRatio != 2.0 {
		t.Errorf("BurstRatio = %v, want 2.0", s.BurstRatio)
	}
}

func TestDuplicatesAndReorder(t *testing.T) {
	c := NewChannel(0, testCfg())
	// Sent 10. Receive 0,1,2,3, then 3 again (dup), skip 4, receive 5,6, then 4 late (reorder).
	feed(c, 10, []int{0, 1, 2, 3, 3, 5, 6, 4, 7, 8, 9})
	s := c.Snapshot(1.0)

	if s.Duplicates != 1 {
		t.Errorf("Duplicates = %d, want 1", s.Duplicates)
	}
	if s.Reordered != 1 {
		t.Errorf("Reordered = %d, want 1", s.Reordered)
	}
	// Unique received = all 10 (4 arrived late), so no loss.
	if s.Lost != 0 {
		t.Errorf("Lost = %d, want 0 (late packet recovered)", s.Lost)
	}
	if s.PacketsRecv != 10 {
		t.Errorf("PacketsRecv = %d, want 10", s.PacketsRecv)
	}
}

func TestRTTAndConstantJitter(t *testing.T) {
	c := NewChannel(0, testCfg())
	var recv []int
	for i := 0; i < 50; i++ {
		recv = append(recv, i)
	}
	feed(c, 50, recv) // perfectly paced, fixed 5ms RTT
	s := c.Snapshot(1.0)

	if s.RTTMeanMs < 4.9 || s.RTTMeanMs > 5.1 {
		t.Errorf("RTTMeanMs = %v, want ~5", s.RTTMeanMs)
	}
	// Constant spacing and constant transit -> jitter ~0.
	if s.JitterMs > 0.5 {
		t.Errorf("JitterMs = %v, want ~0 for constant spacing", s.JitterMs)
	}
	if !s.OneWayEstimated {
		t.Error("OneWayEstimated should be true")
	}
	if s.OneWayMs < 2.4 || s.OneWayMs > 2.6 {
		t.Errorf("OneWayMs = %v, want ~2.5 (RTT/2)", s.OneWayMs)
	}
}

func TestJitterRisesWithVariation(t *testing.T) {
	c := NewChannel(0, testCfg())
	base := int64(1_000_000_000)
	for i := 0; i < 50; i++ {
		c.IncSent()
		seq := uint16(i)
		ts := uint32(i) * 160
		wobble := int64(0)
		if i%2 == 0 {
			wobble = 8_000_000 // 8ms late on even packets
		}
		now := base + int64(i)*20_000_000 + wobble
		c.OnReceive(seq, ts, now-5_000_000, now)
	}
	s := c.Snapshot(1.0)
	if s.JitterMs < 1.0 {
		t.Errorf("JitterMs = %v, want elevated for wobbling arrivals", s.JitterMs)
	}
	if s.JitterMaxMs < s.JitterMs {
		t.Errorf("JitterMaxMs (%v) should be >= mean (%v)", s.JitterMaxMs, s.JitterMs)
	}
}

func TestVerdictFailsOnLoss(t *testing.T) {
	c := NewChannel(0, testCfg())
	// 10% loss -> should fail loss threshold (1%) and drag MOS down.
	var recv []int
	for i := 0; i < 100; i++ {
		if i%10 == 0 {
			continue // drop every 10th
		}
		recv = append(recv, i)
	}
	feed(c, 100, recv)
	s := c.Snapshot(1.0)
	if s.Pass {
		t.Errorf("expected FAIL at 10%% loss, got PASS (MOS %v, loss %v)", s.MOS, s.LossPct)
	}
	found := false
	for _, r := range s.FailReasons {
		if r == "loss" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected 'loss' in fail reasons, got %v", s.FailReasons)
	}
}

func TestAggregate(t *testing.T) {
	mk := func(idx int, loss, mos float64, pass bool) protocol.ChannelStats {
		return protocol.ChannelStats{
			Channel: idx, LossPct: loss, MOS: mos, Pass: pass,
			PacketsRecv: 100, Lost: int64(loss), JitterMs: 5, RTTMeanMs: 10,
			OneWayMs: 5, RFactor: 90, BitrateKbps: 80, ExpectedKbps: 80,
		}
	}
	chans := []protocol.ChannelStats{
		mk(0, 0, 4.4, true),
		mk(1, 2, 3.5, false),
	}
	a := Aggregate(chans)
	if a.Pass {
		t.Error("aggregate should FAIL when any channel fails")
	}
	if a.WorstChan != 1 {
		t.Errorf("WorstChan = %d, want 1 (lowest MOS)", a.WorstChan)
	}
	if a.MOSMin != 3.5 {
		t.Errorf("MOSMin = %v, want 3.5", a.MOSMin)
	}
}
