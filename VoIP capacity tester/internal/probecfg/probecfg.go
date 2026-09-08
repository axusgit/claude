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
