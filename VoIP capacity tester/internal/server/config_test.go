package server

import (
	"testing"

	"voiptest/internal/codec"
	"voiptest/internal/protocol"
)

// TestNormalizeShorthand: a flat single-profile config folds into one Profile,
// the shorthand is cleared, and defaults are applied.
func TestNormalizeShorthand(t *testing.T) {
	c := protocol.TestConfig{Codec: protocol.CodecG711, Channels: 5, DurationSec: 10}
	if err := normalizeConfig(&c); err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if len(c.Profiles) != 1 || c.Profiles[0].Channels != 5 || c.Profiles[0].Codec != protocol.CodecG711 {
		t.Fatalf("fold = %+v", c.Profiles)
	}
	if c.Codec != "" || c.Channels != 0 {
		t.Errorf("shorthand not cleared: codec=%q channels=%d", c.Codec, c.Channels)
	}
	if c.Transport != protocol.TransportUDP {
		t.Errorf("default transport = %q, want udp", c.Transport)
	}
	if c.Profiles[0].PtimeMs != 20 {
		t.Errorf("default ptime = %d, want 20", c.Profiles[0].PtimeMs)
	}
}

// TestNormalizeMixed: mixed profiles validate, Opus gets its default bitrate.
func TestNormalizeMixed(t *testing.T) {
	c := protocol.TestConfig{
		DurationSec: 10,
		Profiles: []protocol.Profile{
			{Codec: protocol.CodecOpus, Channels: 2},
			{Codec: protocol.CodecG729, Channels: 3},
		},
	}
	if err := normalizeConfig(&c); err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if c.Profiles[0].BitrateKbps != codec.DefaultOpusKbps {
		t.Errorf("opus default bitrate = %d, want %d", c.Profiles[0].BitrateKbps, codec.DefaultOpusKbps)
	}
	if c.TotalChannels() != 5 {
		t.Errorf("total = %d, want 5", c.TotalChannels())
	}
}

// TestNormalizeOverLimit: total channels above the cap is rejected.
func TestNormalizeOverLimit(t *testing.T) {
	c := protocol.TestConfig{
		DurationSec: 10,
		Profiles: []protocol.Profile{
			{Codec: protocol.CodecG711, Channels: 3000},
			{Codec: protocol.CodecG711, Channels: 3000},
		},
	}
	if err := normalizeConfig(&c); err == nil {
		t.Fatal("expected over-limit error for 6000 total channels")
	}
}
