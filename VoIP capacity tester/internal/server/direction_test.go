package server

import (
	"testing"

	"voiptest/internal/protocol"
	"voiptest/internal/rtp"
)

// TestDirectionStats checks the two-leg loss decomposition: forward loss comes
// from client-sent minus collector-received, and return loss from
// collector-received minus client round-trip-received.
func TestDirectionStats(t *testing.T) {
	cfg := protocol.TestConfig{
		Codec: protocol.CodecG711, Channels: 1,
		Transport: protocol.TransportUDP, DurationSec: 1, PtimeMs: 20,
	}
	tst := newTest("TEST01", cfg)

	// Simulate the collector receiving 95 of the 100 packets the client sent
	// (5 lost on the forward leg). Feed 95 contiguous RTP packets on one SSRC.
	const ssrc = uint32(0xABCDEF01)
	var now int64 = 1
	for i := 0; i < 95; i++ {
		pkt := make([]byte, rtp.HeaderSize+20)
		rtp.Header{PayloadType: 0, Sequence: uint16(i), SSRC: ssrc}.Marshal(pkt)
		tst.observeForward(pkt, now)
		now += 20 * 1_000_000
	}

	// Client reports: sent 100, round-trip received 90 (so 5 lost on return).
	tst.mu.Lock()
	tst.channels = []protocol.ChannelStats{{
		Channel: 0, SSRC: ssrc, PacketsSent: 100, PacketsRecv: 90,
	}}
	fwd, ret, fAgg, rAgg := tst.directionStatsLocked()
	tst.mu.Unlock()

	if len(fwd) != 1 || len(ret) != 1 {
		t.Fatalf("expected 1 forward and 1 return row, got %d/%d", len(fwd), len(ret))
	}
	if fwd[0].Recv != 95 || fwd[0].Lost != 5 {
		t.Errorf("forward recv/lost = %d/%d, want 95/5", fwd[0].Recv, fwd[0].Lost)
	}
	if ret[0].Recv != 90 || ret[0].Lost != 5 {
		t.Errorf("return recv/lost = %d/%d, want 90/5", ret[0].Recv, ret[0].Lost)
	}
	if fAgg.Lost != 5 || rAgg.Lost != 5 {
		t.Errorf("aggregate forward/return lost = %d/%d, want 5/5", fAgg.Lost, rAgg.Lost)
	}
	// Forward loss % = 5/100.
	if fAgg.LossPct != 5.0 {
		t.Errorf("forward loss%% = %.3f, want 5.000", fAgg.LossPct)
	}
	// Return loss % = 5/95.
	if want := round3(100 * 5.0 / 95.0); rAgg.LossPct != want {
		t.Errorf("return loss%% = %.3f, want %.3f", rAgg.LossPct, want)
	}
}

// TestDirectionStatsNoForward verifies that with no forward measurement the
// builder degrades gracefully (forward loss counts every sent packet).
func TestDirectionStatsNoForward(t *testing.T) {
	cfg := protocol.TestConfig{Codec: protocol.CodecG711, Channels: 1, Transport: protocol.TransportUDP, DurationSec: 1, PtimeMs: 20}
	tst := newTest("TEST02", cfg)
	tst.mu.Lock()
	tst.channels = []protocol.ChannelStats{{Channel: 0, SSRC: 7, PacketsSent: 50, PacketsRecv: 50}}
	fwd, _, fAgg, _ := tst.directionStatsLocked()
	tst.mu.Unlock()
	if fwd[0].Recv != 0 || fwd[0].Lost != 50 {
		t.Errorf("forward with no measurement: recv/lost = %d/%d, want 0/50", fwd[0].Recv, fwd[0].Lost)
	}
	if fAgg.LossPct != 100 {
		t.Errorf("forward loss%% = %.1f, want 100", fAgg.LossPct)
	}
}
