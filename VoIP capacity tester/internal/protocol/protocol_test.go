package protocol

import "testing"

func TestChannelPlan(t *testing.T) {
	cfg := TestConfig{Profiles: []Profile{
		{Codec: CodecG711, Channels: 2},
		{Codec: CodecG729, Channels: 3},
	}}
	profs, idx := cfg.ChannelPlan()
	if len(profs) != 5 || len(idx) != 5 {
		t.Fatalf("plan length = %d/%d, want 5/5", len(profs), len(idx))
	}
	if cfg.TotalChannels() != 5 {
		t.Fatalf("TotalChannels = %d, want 5", cfg.TotalChannels())
	}
	wantIdx := []int{0, 0, 1, 1, 1}
	for i, w := range wantIdx {
		if idx[i] != w {
			t.Errorf("profileIndex[%d] = %d, want %d", i, idx[i], w)
		}
	}
	if profs[4].Codec != CodecG729 {
		t.Errorf("channel 4 codec = %s, want g729", profs[4].Codec)
	}
}

func TestPrimaryCodec(t *testing.T) {
	mixed := TestConfig{Profiles: []Profile{{Codec: CodecG711, Channels: 1}, {Codec: CodecG729, Channels: 1}}}
	if mixed.PrimaryCodec() != "" {
		t.Errorf("mixed PrimaryCodec = %q, want empty", mixed.PrimaryCodec())
	}
	single := TestConfig{Profiles: []Profile{{Codec: CodecG722, Channels: 4}}}
	if single.PrimaryCodec() != CodecG722 {
		t.Errorf("single PrimaryCodec = %q, want g722", single.PrimaryCodec())
	}
}
