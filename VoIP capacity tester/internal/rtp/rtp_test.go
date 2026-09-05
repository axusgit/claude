package rtp

import (
	"bytes"
	"testing"
)

func TestHeaderRoundTrip(t *testing.T) {
	h := Header{PayloadType: 18, Marker: true, Sequence: 40000, Timestamp: 123456, SSRC: 0xDEADBEEF}
	buf := make([]byte, HeaderSize)
	h.Marshal(buf)

	if buf[0] != 0x80 {
		t.Errorf("first byte = %#x, want 0x80 (V=2)", buf[0])
	}
	got, ok := ParseHeader(buf)
	if !ok {
		t.Fatal("ParseHeader failed")
	}
	if got != h {
		t.Errorf("round trip: got %+v, want %+v", got, h)
	}
}

func TestPayloadType0NoMarker(t *testing.T) {
	h := Header{PayloadType: 0, Marker: false, Sequence: 1, Timestamp: 160, SSRC: 1}
	buf := make([]byte, HeaderSize)
	h.Marshal(buf)
	if buf[1] != 0 {
		t.Errorf("byte1 = %#x, want 0 (PT 0, no marker)", buf[1])
	}
}

func TestSendTimeRoundTrip(t *testing.T) {
	payload := make([]byte, 160)
	PutSendTime(payload, 1234567890123)
	if got := GetSendTime(payload); got != 1234567890123 {
		t.Errorf("GetSendTime = %d, want 1234567890123", got)
	}
}

func TestFramingRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	pkts := [][]byte{
		[]byte("first packet"),
		[]byte("second, a bit longer packet"),
		{0x80, 0x00, 0x01, 0x02},
	}
	for _, p := range pkts {
		if err := WriteFramed(&buf, p); err != nil {
			t.Fatalf("WriteFramed: %v", err)
		}
	}
	// Deframe and compare — boundaries must be preserved.
	rbuf := make([]byte, 2048)
	for i, want := range pkts {
		n, err := ReadFramed(&buf, rbuf)
		if err != nil {
			t.Fatalf("ReadFramed[%d]: %v", i, err)
		}
		if !bytes.Equal(rbuf[:n], want) {
			t.Errorf("packet %d = %q, want %q", i, rbuf[:n], want)
		}
	}
}
