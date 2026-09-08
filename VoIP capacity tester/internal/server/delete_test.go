package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"voiptest/internal/protocol"
	"voiptest/internal/report"
)

func TestHandleDelete(t *testing.T) {
	dir := t.TempDir()
	s := New(Options{DataDir: dir})
	h := s.Handler()

	// A live (created) test — no media started; closeMedia tolerates nil conns.
	live := "AAA111"
	s.tests[live] = newTest(live, protocol.TestConfig{
		Transport:   protocol.TransportUDP,
		DurationSec: 10,
		Profiles:    []protocol.Profile{{Codec: protocol.CodecG711, Channels: 1, PtimeMs: 20}},
	})

	// A completed test persisted to history (writes <CODE>.json).
	hist := "BBB222"
	s.recordHistory(report.Result{Code: hist, Config: protocol.TestConfig{
		Transport:   protocol.TransportUDP,
		DurationSec: 10,
		Profiles:    []protocol.Profile{{Codec: protocol.CodecG711, Channels: 1, PtimeMs: 20}},
	}})
	if _, err := os.Stat(filepath.Join(dir, hist+".json")); err != nil {
		t.Fatalf("precondition: history file not written: %v", err)
	}

	del := func(code string) int {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/api/admin/tests/"+code, nil))
		return rr.Code
	}

	// Delete the live test: gone from the map.
	if got := del(live); got != http.StatusNoContent {
		t.Fatalf("delete live: got %d want 204", got)
	}
	if _, ok := s.tests[live]; ok {
		t.Fatalf("live test still present after delete")
	}

	// Delete the history test: gone from memory and disk.
	if got := del(hist); got != http.StatusNoContent {
		t.Fatalf("delete history: got %d want 204", got)
	}
	if _, ok := s.historyGet(hist); ok {
		t.Fatalf("history entry still present after delete")
	}
	if _, err := os.Stat(filepath.Join(dir, hist+".json")); !os.IsNotExist(err) {
		t.Fatalf("history file not removed (err=%v)", err)
	}

	// Unknown code -> 404. Malformed code -> 400.
	if got := del("ZZZ999"); got != http.StatusNotFound {
		t.Fatalf("delete unknown: got %d want 404", got)
	}
	if got := del("AA-11"); got != http.StatusBadRequest {
		t.Fatalf("delete malformed: got %d want 400", got)
	}
}
