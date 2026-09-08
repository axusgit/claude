// Package probecfg embeds a tiny {server, code} config as a trailer appended to
// probegui.exe at download time, so a downloaded probe is pre-bound to one test
// CODE and connects with no typing at all.
//
// The trailer is appended AFTER the PE image. Windows ignores bytes past the
// image described by the PE headers, so:
//   - the base probegui.exe (no trailer) runs normally, and
//   - a trailered copy still runs, and additionally finds its config.
//
// It also survives the browser renaming the download (e.g. "probegui (1).exe"),
// because the probe reads the trailer from its own bytes, not the filename.
//
// Layout:  [ exe image ][ json payload ][ uint32 BE payload len ][ 16-byte magic ]
package probecfg

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// Config is what a downloaded probe is pre-loaded with.
type Config struct {
	Server string `json:"server"`
	Code   string `json:"code"`
}

// magic is the fixed 16-byte end marker of a config trailer.
var magic = []byte{'V', 'O', 'I', 'P', 'G', 'U', 'I', 'C', 'F', 'G', '1', 0, 0, 0, 0, 0}

const footerLen = 4 + 16 // uint32 payload length + magic

// Append returns base with cfg appended as a trailer.
func Append(base []byte, cfg Config) ([]byte, error) {
	payload, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(base)+len(payload)+footerLen)
	out = append(out, base...)
	out = append(out, payload...)
	var n [4]byte
	binary.BigEndian.PutUint32(n[:], uint32(len(payload)))
	out = append(out, n[:]...)
	out = append(out, magic...)
	return out, nil
}

// Parse extracts a Config from bytes that may carry a trailer. ok is false when
// there is no valid trailer (a plain, un-configured build).
func Parse(b []byte) (cfg Config, ok bool) {
	if len(b) < footerLen {
		return Config{}, false
	}
	if !bytes.Equal(b[len(b)-16:], magic) {
		return Config{}, false
	}
	n := binary.BigEndian.Uint32(b[len(b)-footerLen : len(b)-16])
	if n == 0 || int(n) > len(b)-footerLen {
		return Config{}, false
	}
	start := len(b) - footerLen - int(n)
	if err := json.Unmarshal(b[start:len(b)-footerLen], &cfg); err != nil {
		return Config{}, false
	}
	return cfg, true
}

// codeInName matches the CODE embedded in a downloaded filename, e.g.
// "voiptesterprobe-AB12CD.exe" (and tolerates a browser's " (1)" suffix).
var codeInName = regexp.MustCompile(`(?i)voiptesterprobe-([A-Z0-9]{4,16})`)

// CodeFromName extracts the test CODE from a probe's filename, or "" if absent.
// This is the signature-SAFE way to bind a CODE to a signed download: the bytes
// are untouched (so an Authenticode signature stays valid) and the CODE rides in
// the filename the collector sets via Content-Disposition.
func CodeFromName(name string) string {
	m := codeInName.FindStringSubmatch(name)
	if m == nil {
		return ""
	}
	return strings.ToUpper(m[1])
}

// IsSigned reports whether a PE image carries an Authenticode signature (a
// non-empty Certificate Table in data directory entry 4). The collector uses
// this to decide NOT to append a config trailer to a signed probe (which would
// invalidate the signature) and to rely on the filename CODE instead.
func IsSigned(b []byte) bool {
	if len(b) < 0x40 || b[0] != 'M' || b[1] != 'Z' {
		return false
	}
	pe := int(binary.LittleEndian.Uint32(b[0x3C:0x40]))
	if pe < 0 || pe+24 > len(b) || string(b[pe:pe+4]) != "PE\x00\x00" {
		return false
	}
	opt := pe + 24 // optional header follows the 4-byte sig + 20-byte COFF header
	if opt+2 > len(b) {
		return false
	}
	var ddStart int
	switch binary.LittleEndian.Uint16(b[opt : opt+2]) {
	case 0x20b: // PE32+
		ddStart = opt + 112
	case 0x10b: // PE32
		ddStart = opt + 96
	default:
		return false
	}
	secEntry := ddStart + 4*8 // data directory index 4 = Certificate Table
	if secEntry+8 > len(b) {
		return false
	}
	size := binary.LittleEndian.Uint32(b[secEntry+4 : secEntry+8])
	return size > 0
}

// FromSelf reads the running executable and parses any embedded trailer.
func FromSelf() (Config, bool) {
	exe, err := os.Executable()
	if err != nil {
		return Config{}, false
	}
	b, err := os.ReadFile(exe)
	if err != nil {
		return Config{}, false
	}
	return Parse(b)
}
