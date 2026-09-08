package probecfg

import "testing"

func TestAppendParseRoundTrip(t *testing.T) {
	base := []byte("pretend this is a PE image \x00\x01\x02 with arbitrary bytes")
	want := Config{Server: "https://voiptest.axustechnologies.com", Code: "AB12CD"}

	out, err := Append(base, want)
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	if len(out) <= len(base) {
		t.Fatalf("Append did not grow the image")
	}
	// The base image must be byte-for-byte preserved at the front.
	if string(out[:len(base)]) != string(base) {
		t.Fatalf("base image was altered")
	}

	got, ok := Parse(out)
	if !ok {
		t.Fatalf("Parse returned ok=false on a trailered image")
	}
	if got != want {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, want)
	}
}

func TestParsePlainImageHasNoConfig(t *testing.T) {
	if _, ok := Parse([]byte("just a normal exe with no trailer")); ok {
		t.Fatalf("Parse found a config in a plain image")
	}
	if _, ok := Parse(nil); ok {
		t.Fatalf("Parse found a config in nil")
	}
}

func TestParseRejectsBadLength(t *testing.T) {
	// A valid magic but an absurd length must not panic or falsely succeed.
	b := make([]byte, footerLen)
	copy(b[len(b)-16:], magic)
	b[0] = 0xff // huge length in the uint32 slot
	if _, ok := Parse(b); ok {
		t.Fatalf("Parse accepted an out-of-range payload length")
	}
}
