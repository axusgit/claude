package probecfg

import (
	"encoding/binary"
	"testing"
)

func TestCodeFromName(t *testing.T) {
	cases := map[string]string{
		"voiptesterprobe-AB12CD.exe":     "AB12CD",
		"voiptesterprobe-ab12cd.exe":     "AB12CD", // case-insensitive -> upper
		"voiptesterprobe-AB12CD (1).exe": "AB12CD", // browser dedupe suffix
		"voiptesterprobe.exe":            "",       // no code
		"something-else.exe":             "",
		"":                              "",
	}
	for name, want := range cases {
		if got := CodeFromName(name); got != want {
			t.Errorf("CodeFromName(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestIsSigned(t *testing.T) {
	if IsSigned(nil) || IsSigned([]byte("not a PE")) {
		t.Fatalf("IsSigned reported true for non-PE input")
	}
	// Minimal PE32+ skeleton with a Certificate Table (data dir 4) size field.
	mk := func(secSize uint32) []byte {
		b := make([]byte, 256)
		b[0], b[1] = 'M', 'Z'
		binary.LittleEndian.PutUint32(b[0x3C:], 0x40) // e_lfanew
		copy(b[0x40:], "PE\x00\x00")
		binary.LittleEndian.PutUint16(b[0x40+24:], 0x20b) // PE32+ optional magic
		// data dirs start at opt+112 = 0x40+24+112 = 200; entry 4 at +32 = 232; size at +4.
		binary.LittleEndian.PutUint32(b[236:], secSize)
		return b
	}
	if IsSigned(mk(0)) {
		t.Errorf("IsSigned = true for zero-size Certificate Table")
	}
	if !IsSigned(mk(0x1800)) {
		t.Errorf("IsSigned = false for non-zero Certificate Table")
	}
}

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
