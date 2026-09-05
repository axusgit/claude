// Package codec holds the per-codec constants that drive packet sizing, RTP
// timestamping, and the E-model quality calculation. We never run a real codec
// (the payload is synthetic), but every number that affects load and metrics —
// payload type, payload size, clock rate, and the E-model Ie/Bpl values — is the
// real value for that codec.
package codec

import "voiptest/internal/protocol"

// Info describes one codec.
type Info struct {
	Name        string  // human-readable
	PayloadType uint8   // RTP static payload type (PT)
	BytesPerMs  float64 // payload bytes per millisecond of audio
	ClockRate   uint32  // RTP timestamp clock (Hz)

	// ITU-T G.113 Appendix I equipment-impairment values for the E-model.
	Ie  float64 // equipment impairment factor at zero loss
	Bpl float64 // packet-loss robustness factor
}

// For returns the Info for a codec, defaulting to G.711 for unknown values.
func For(c protocol.Codec) Info {
	switch c {
	case protocol.CodecG729:
		// G.729: 10 bytes per 10 ms frame -> 1 byte/ms; PT 18; 8 kHz clock.
		return Info{Name: "G.729", PayloadType: 18, BytesPerMs: 1.0, ClockRate: 8000, Ie: 11, Bpl: 19.0}
	default:
		// G.711 u-law: 8 kHz * 1 byte/sample -> 8 bytes/ms; PT 0; 8 kHz clock.
		return Info{Name: "G.711 u-law", PayloadType: 0, BytesPerMs: 8.0, ClockRate: 8000, Ie: 0, Bpl: 25.1}
	}
}

// PayloadBytes returns the media payload size for the given packetization time.
//   G.711 @ 20ms = 160 B, @10ms = 80 B, @30ms = 240 B
//   G.729 @ 20ms = 20 B,  @10ms = 10 B, @30ms = 30 B
func (i Info) PayloadBytes(ptimeMs int) int {
	return int(i.BytesPerMs * float64(ptimeMs))
}

// TimestampIncrement returns how much the RTP timestamp advances per packet.
func (i Info) TimestampIncrement(ptimeMs int) uint32 {
	return uint32(i.ClockRate/1000) * uint32(ptimeMs)
}

// PacketsPerSec returns the packet rate for a given ptime (50 pps at 20 ms).
func PacketsPerSec(ptimeMs int) float64 {
	if ptimeMs <= 0 {
		return 0
	}
	return 1000.0 / float64(ptimeMs)
}

// IPBytesPerPacket returns the estimated on-the-wire bytes per packet at the IP
// layer, including RTP + transport + IP overhead. TCP adds a larger header plus
// the RFC 4571 2-byte framing prefix.
func IPBytesPerPacket(payloadBytes int, transport protocol.Transport) int {
	rtpAndPayload := payloadBytes + 12 // + RTP header
	switch transport {
	case protocol.TransportTCP:
		return rtpAndPayload + 2 + 20 + 20 // 4571 frame + TCP + IP (no options)
	default:
		return rtpAndPayload + 8 + 20 // UDP + IP
	}
}

// ExpectedKbps returns the expected IP-layer bitrate for one channel.
func ExpectedKbps(payloadBytes, ptimeMs int, transport protocol.Transport) float64 {
	return float64(IPBytesPerPacket(payloadBytes, transport)) * 8 * PacketsPerSec(ptimeMs) / 1000.0
}
