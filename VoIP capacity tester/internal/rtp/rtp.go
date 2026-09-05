// Package rtp implements the minimal RTP (RFC 3550) packet handling this tool
// needs, plus RFC 4571 length-prefix framing for carrying RTP over TCP.
//
// We build real 12-byte RTP headers (version, payload type, sequence number,
// timestamp, SSRC) so the traffic is indistinguishable from a real call at the
// transport layer. The payload is synthetic, but its first 8 bytes carry the
// sender's monotonic send time so the round-trip time can be measured from the
// echoed packet without needing synced clocks.
package rtp

import (
	"encoding/binary"
	"fmt"
	"io"
)

// HeaderSize is the size of a fixed RTP header with no CSRCs or extensions.
const HeaderSize = 12

// SendTimeSize is how many payload bytes we reserve for the embedded send time.
const SendTimeSize = 8

// Header is a fixed RTP header (V=2, P=0, X=0, CC=0).
type Header struct {
	PayloadType uint8
	Marker      bool
	Sequence    uint16
	Timestamp   uint32
	SSRC        uint32
}

// Marshal writes the 12-byte header into dst, which must be at least HeaderSize.
func (h Header) Marshal(dst []byte) {
	_ = dst[HeaderSize-1] // bounds-check hint
	dst[0] = 0x80         // V=2, P=0, X=0, CC=0
	b1 := h.PayloadType & 0x7f
	if h.Marker {
		b1 |= 0x80
	}
	dst[1] = b1
	binary.BigEndian.PutUint16(dst[2:4], h.Sequence)
	binary.BigEndian.PutUint32(dst[4:8], h.Timestamp)
	binary.BigEndian.PutUint32(dst[8:12], h.SSRC)
}

// ParseHeader parses the fixed 12-byte header from b.
func ParseHeader(b []byte) (Header, bool) {
	if len(b) < HeaderSize {
		return Header{}, false
	}
	if b[0]>>6 != 2 { // version must be 2
		return Header{}, false
	}
	return Header{
		PayloadType: b[1] & 0x7f,
		Marker:      b[1]&0x80 != 0,
		Sequence:    binary.BigEndian.Uint16(b[2:4]),
		Timestamp:   binary.BigEndian.Uint32(b[4:8]),
		SSRC:        binary.BigEndian.Uint32(b[8:12]),
	}, true
}

// PutSendTime writes the sender's monotonic nanosecond timestamp into the start
// of the payload region (the bytes immediately after the RTP header).
func PutSendTime(payload []byte, tNanos int64) {
	if len(payload) >= SendTimeSize {
		binary.BigEndian.PutUint64(payload[:SendTimeSize], uint64(tNanos))
	}
}

// GetSendTime reads a send time previously written by PutSendTime.
func GetSendTime(payload []byte) int64 {
	if len(payload) >= SendTimeSize {
		return int64(binary.BigEndian.Uint64(payload[:SendTimeSize]))
	}
	return 0
}

// WriteFramed writes an RFC 4571 framed packet: a 2-byte big-endian length
// prefix followed by the RTP packet. Used for RTP over TCP so the receiver can
// recover packet boundaries from the byte stream.
func WriteFramed(w io.Writer, pkt []byte) error {
	if len(pkt) > 0xffff {
		return fmt.Errorf("rtp: packet too large for 16-bit frame prefix: %d", len(pkt))
	}
	var buf [2]byte
	binary.BigEndian.PutUint16(buf[:], uint16(len(pkt)))
	// Write prefix and packet with a single call each; callers on TCP should
	// wrap the conn in a bufio.Writer if they want them coalesced.
	if _, err := w.Write(buf[:]); err != nil {
		return err
	}
	_, err := w.Write(pkt)
	return err
}

// ReadFramed reads one RFC 4571 framed packet into buf and returns its length.
// buf must be large enough to hold the largest expected RTP packet.
func ReadFramed(r io.Reader, buf []byte) (int, error) {
	var prefix [2]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		return 0, err
	}
	n := int(binary.BigEndian.Uint16(prefix[:]))
	if n > len(buf) {
		return 0, fmt.Errorf("rtp: framed packet (%d) exceeds buffer (%d)", n, len(buf))
	}
	if _, err := io.ReadFull(r, buf[:n]); err != nil {
		return 0, err
	}
	return n, nil
}
