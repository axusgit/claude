package codec

import (
	"testing"

	"voiptest/internal/protocol"
)

// TestForParams pins the payload-type, clock and per-packet sizing for every
// codec — the numbers that drive real network load and RTP realism.
func TestForParams(t *testing.T) {
	cases := []struct {
		codec        protocol.Codec
		wantPT       uint8
		wantClock    uint32
		wantPayload20 int // payload bytes at 20 ms
	}{
		{protocol.CodecG711, 0, 8000, 160},
		{protocol.CodecG729, 18, 8000, 20},
		{protocol.CodecG722, 9, 8000, 160},  // 64 kbps, wideband, 8 kHz RTP clock quirk
		{protocol.CodecOpus, 111, 48000, 80}, // default 32 kbps -> 4 B/ms -> 80 B @20ms
	}
	for _, c := range cases {
		i := For(c.codec)
		if i.PayloadType != c.wantPT {
			t.Errorf("%s PT = %d, want %d", c.codec, i.PayloadType, c.wantPT)
		}
		if i.ClockRate != c.wantClock {
			t.Errorf("%s clock = %d, want %d", c.codec, i.ClockRate, c.wantClock)
		}
		if got := i.PayloadBytes(20); got != c.wantPayload20 {
			t.Errorf("%s payload@20ms = %d, want %d", c.codec, got, c.wantPayload20)
		}
	}
}

// TestOpusBitrateOverride verifies ForConfig scales the Opus payload with the
// configured bitrate, and that fixed-rate codecs ignore any bitrate.
func TestOpusBitrateOverride(t *testing.T) {
	opus := ForConfig(protocol.TestConfig{Codec: protocol.CodecOpus, PtimeMs: 20, BitrateKbps: 48})
	if got := opus.PayloadBytes(20); got != 120 { // 48 kbps -> 6 B/ms -> 120 B
		t.Errorf("opus@48k payload@20ms = %d, want 120", got)
	}
	// Default (no override) stays at 32 kbps -> 80 B.
	def := ForConfig(protocol.TestConfig{Codec: protocol.CodecOpus, PtimeMs: 20})
	if got := def.PayloadBytes(20); got != 80 {
		t.Errorf("opus default payload@20ms = %d, want 80", got)
	}
	// Fixed-rate codec ignores a stray bitrate.
	g711 := ForConfig(protocol.TestConfig{Codec: protocol.CodecG711, PtimeMs: 20, BitrateKbps: 48})
	if got := g711.PayloadBytes(20); got != 160 {
		t.Errorf("g711 payload@20ms = %d, want 160 (bitrate must be ignored)", got)
	}
}

// TestG722Bitrate confirms G.722 imposes the full 64 kbps media load (same
// payload sizing as G.711), i.e. the wideband codec is not mistakenly narrow.
func TestG722Bitrate(t *testing.T) {
	i := For(protocol.CodecG722)
	if kbps := ExpectedKbps(i.PayloadBytes(20), 20, protocol.TransportUDP); kbps != 80 {
		t.Errorf("G.722 UDP expected kbps = %.1f, want 80", kbps)
	}
}
