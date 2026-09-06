// Package server implements the collector: the HTTP/JSON control API, the
// per-test RTP echo endpoints, live aggregation, the SSE feeds, and the embedded
// web dashboard — all from a single binary and a single HTTP port.
package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"voiptest/internal/codec"
	"voiptest/internal/protocol"
	"voiptest/internal/report"
)

//go:embed web
var webFS embed.FS

// Options configures the server.
type Options struct {
	Addr      string  // HTTP listen address, e.g. ":8080"
	MediaBind string  // interface to bind media listeners on ("" = all)
	Advertise string  // media host advertised to clients ("" = derive from request Host)
	SSEHz     float64 // dashboard refresh rate hint (informational; pushes are event-driven)
	DataDir   string  // if set, completed test reports are persisted here and reloaded on startup (history)

	MediaPortMin int // if >0, per-test media echo ports are chosen from [MediaPortMin,MediaPortMax] (for cloud firewalls)
	MediaPortMax int
	ProbeExe     string // if set, this probe.exe is served at /download/probe.exe for technicians
}

// Server is the collector.
type Server struct {
	opts  Options
	mu    sync.RWMutex
	tests map[string]*Test

	// Completed-test history: survives across restarts when DataDir is set, and
	// lets finished tests be listed, reported and compared after their live Test
	// object is gone. Keyed by CODE.
	histMu  sync.Mutex
	history map[string]report.Result

	listMu   sync.Mutex
	listSubs map[chan []byte]struct{}
}

// New creates a Server.
func New(opts Options) *Server {
	if opts.SSEHz <= 0 {
		opts.SSEHz = 1
	}
	s := &Server{
		opts:     opts,
		tests:    make(map[string]*Test),
		history:  make(map[string]report.Result),
		listSubs: make(map[chan []byte]struct{}),
	}
	if opts.DataDir != "" {
		if err := s.loadHistory(); err != nil {
			log.Printf("history: could not load from %s: %v", opts.DataDir, err)
		} else if n := len(s.history); n > 0 {
			log.Printf("history: loaded %d past test(s) from %s", n, opts.DataDir)
		}
	}
	return s
}

// Handler builds the HTTP routing tree (Go 1.22 pattern mux).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /api/tests", s.handleCreate)
	mux.HandleFunc("GET /api/tests", s.handleList)
	mux.HandleFunc("GET /api/tests/{code}", s.handleDetail)
	mux.HandleFunc("POST /api/tests/{code}/claim", s.handleClaim)
	mux.HandleFunc("POST /api/tests/{code}/stats", s.handleStats)
	mux.HandleFunc("GET /api/tests/{code}/stream", s.handleTestStream)
	mux.HandleFunc("GET /api/tests/{code}/report", s.handleReport)
	mux.HandleFunc("GET /api/stream", s.handleListStream)
	mux.HandleFunc("GET /api/config", s.handleServerConfig)
	if s.opts.ProbeExe != "" {
		mux.HandleFunc("GET /download/probe.exe", s.handleProbeDownload)
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(sub)))
	return mux
}

// Run starts the janitor and blocks serving HTTP.
func (s *Server) Run() error {
	go s.janitor()
	srv := &http.Server{Addr: s.opts.Addr, Handler: s.Handler()}
	log.Printf("collector listening on %s (dashboard + control API)", s.opts.Addr)
	return srv.ListenAndServe()
}

// ---- Handlers ---------------------------------------------------------------

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var cfg protocol.TestConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid JSON: %v", err)
		return
	}
	if err := normalizeConfig(&cfg); err != nil {
		httpErr(w, http.StatusBadRequest, "%v", err)
		return
	}

	// Allocate a unique code and its media listener.
	code := s.uniqueCode()
	t := newTest(code, cfg)
	if err := t.startMedia(s.opts.MediaBind, s.opts.MediaPortMin, s.opts.MediaPortMax); err != nil {
		httpErr(w, http.StatusInternalServerError, "media allocation failed: %v", err)
		return
	}

	s.mu.Lock()
	s.tests[code] = t
	s.mu.Unlock()
	s.broadcastList()

	writeJSON(w, http.StatusCreated, protocol.CreateTestResponse{
		Code:   code,
		Config: cfg,
		Media: protocol.MediaEndpoint{
			Host:      s.opts.Advertise,
			Port:      t.mediaPort,
			Transport: cfg.Transport,
		},
	})
}

func (s *Server) handleClaim(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	t := s.get(code)
	if t == nil {
		httpErr(w, http.StatusNotFound, "no such test code %q", code)
		return
	}

	var req protocol.ClaimRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // body optional

	t.mu.Lock()
	// One CODE = one client session: reject a second claimant of an active test.
	if t.State != protocol.StateCreated {
		state := t.State
		t.mu.Unlock()
		httpErr(w, http.StatusConflict,
			"test %s already %s by client %q — a code is single-use", code, state, t.ClientID)
		return
	}
	t.State = protocol.StateClaimed
	t.ClaimedAt = time.Now()
	t.ClientID = req.ClientID
	t.ClientIP = clientIP(r)
	mediaHost := s.mediaHost(r)
	t.MediaHost = mediaHost
	cfg := t.Config
	port := t.mediaPort
	t.mu.Unlock()

	s.broadcastList()

	writeJSON(w, http.StatusOK, protocol.ClaimResponse{
		Code:   code,
		Config: cfg,
		Media: protocol.MediaEndpoint{
			Host:      mediaHost,
			Port:      port,
			Transport: cfg.Transport,
		},
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	t := s.get(code)
	if t == nil {
		httpErr(w, http.StatusNotFound, "no such test code %q", code)
		return
	}
	var rep protocol.StatsReport
	if err := json.NewDecoder(r.Body).Decode(&rep); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid stats JSON: %v", err)
		return
	}
	detail := t.applyStats(rep)
	if rep.Final {
		s.recordHistory(t.result())
	}
	t.broadcast(detail)
	s.broadcastList()
	w.WriteHeader(http.StatusNoContent)
}

// ---- History (completed tests) ----------------------------------------------

// recordHistory stores a completed test's report in memory and, when a data dir
// is configured, on disk so it survives a restart.
func (s *Server) recordHistory(res report.Result) {
	if res.Code == "" {
		return
	}
	s.histMu.Lock()
	s.history[res.Code] = res
	s.histMu.Unlock()
	if s.opts.DataDir == "" {
		return
	}
	if err := os.MkdirAll(s.opts.DataDir, 0o755); err != nil {
		log.Printf("history: mkdir %s: %v", s.opts.DataDir, err)
		return
	}
	b, err := json.MarshalIndent(res, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(filepath.Join(s.opts.DataDir, res.Code+".json"), b, 0o644); err != nil {
		log.Printf("history: write %s: %v", res.Code, err)
	}
}

// loadHistory reads any persisted reports from the data dir into memory.
func (s *Server) loadHistory() error {
	entries, err := os.ReadDir(s.opts.DataDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.opts.DataDir, e.Name()))
		if err != nil {
			continue
		}
		var res report.Result
		if err := json.Unmarshal(b, &res); err != nil {
			continue
		}
		if res.Code != "" {
			s.history[res.Code] = res
		}
	}
	return nil
}

func (s *Server) historyGet(code string) (report.Result, bool) {
	s.histMu.Lock()
	defer s.histMu.Unlock()
	r, ok := s.history[code]
	return r, ok
}

// detailFromResult renders a stored report into the same JSON shape the live
// detail feed uses, so the dashboard can open a completed test after restart.
func detailFromResult(res report.Result) []byte {
	b, _ := json.Marshal(map[string]any{
		"code":        res.Code,
		"state":       protocol.StateComplete,
		"config":      res.Config,
		"client_id":   res.ClientID,
		"client_ip":   res.ClientIP,
		"media_port":  0,
		"elapsed_sec": res.Config.DurationSec,
		"remain_sec":  0,
		"aggregate":   res.Aggregate,
		"channels":    res.Channels,
		"forward":     res.Forward,
		"return":      res.Return,
		"forward_agg": res.ForwardAgg,
		"return_agg":  res.ReturnAgg,
		"history":     []any{},
	})
	return b
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tests": s.summaries()})
}

func (s *Server) handleDetail(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	t := s.get(code)
	if t == nil {
		if res, ok := s.historyGet(code); ok {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(detailFromResult(res))
			return
		}
		httpErr(w, http.StatusNotFound, "no such test code %q", code)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(t.detailJSON())
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	t := s.get(code)
	var res report.Result
	if t != nil {
		res = t.result()
	} else if h, ok := s.historyGet(code); ok {
		res = h
	} else {
		httpErr(w, http.StatusNotFound, "no such test code %q", code)
		return
	}
	switch r.URL.Query().Get("format") {
	case "json":
		w.Header().Set("Content-Type", "application/json")
		_ = report.WriteJSON(w, res)
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.csv", code))
		_ = report.WriteCSV(w, res)
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_ = report.WriteText(w, res)
	}
}

// handleServerConfig tells the dashboard what optional features are available
// (currently: whether a probe.exe can be downloaded from this collector).
func (s *Server) handleServerConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"probe_download": s.opts.ProbeExe != "",
	})
}

// handleProbeDownload serves the configured probe.exe so an admin can hand it to
// a technician straight from the dashboard.
func (s *Server) handleProbeDownload(w http.ResponseWriter, r *http.Request) {
	if s.opts.ProbeExe == "" {
		httpErr(w, http.StatusNotFound, "no probe binary configured")
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=probe.exe")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, s.opts.ProbeExe)
}

// ---- SSE --------------------------------------------------------------------

func (s *Server) handleTestStream(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(r.PathValue("code"))
	t := s.get(code)
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	if t == nil {
		// Not live: if we have it in history, send a single snapshot and close.
		if res, ok := s.historyGet(code); ok {
			sseHeaders(w)
			writeSSE(w, detailFromResult(res))
			flusher.Flush()
			return
		}
		httpErr(w, http.StatusNotFound, "no such test code %q", code)
		return
	}
	sseHeaders(w)

	// Send an initial snapshot immediately.
	writeSSE(w, t.detailJSON())
	flusher.Flush()

	ch := t.subscribe()
	defer t.unsubscribe(ch)
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			writeSSE(w, msg)
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) handleListStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	sseHeaders(w)

	ch := make(chan []byte, 4)
	s.listMu.Lock()
	s.listSubs[ch] = struct{}{}
	s.listMu.Unlock()
	defer func() {
		s.listMu.Lock()
		delete(s.listSubs, ch)
		s.listMu.Unlock()
		close(ch)
	}()

	writeSSE(w, s.listJSON())
	flusher.Flush()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			writeSSE(w, msg)
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (s *Server) broadcastList() {
	msg := s.listJSON()
	s.listMu.Lock()
	defer s.listMu.Unlock()
	for ch := range s.listSubs {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (s *Server) listJSON() []byte {
	b, _ := json.Marshal(map[string]any{"tests": s.summaries()})
	return b
}

func (s *Server) summaries() []protocol.TestSummary {
	s.mu.RLock()
	out := make([]protocol.TestSummary, 0, len(s.tests))
	live := make(map[string]struct{}, len(s.tests))
	for _, t := range s.tests {
		out = append(out, t.summary())
		live[t.Code] = struct{}{}
	}
	s.mu.RUnlock()
	// Include persisted history not currently live (e.g. reloaded after restart).
	s.histMu.Lock()
	for code, res := range s.history {
		if _, ok := live[code]; ok {
			continue
		}
		out = append(out, resultSummary(res))
	}
	s.histMu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

// resultSummary builds a list row from a stored (completed) report.
func resultSummary(res report.Result) protocol.TestSummary {
	return protocol.TestSummary{
		Code:       res.Code,
		State:      protocol.StateComplete,
		Codec:      summaryCodec(res.Config),
		Transport:  res.Config.Transport,
		Channels:   res.Config.TotalChannels(),
		PtimeMs:    summaryPtime(res.Config),
		ClientID:   res.ClientID,
		ClientIP:   res.ClientIP,
		ElapsedSec: float64(res.Config.DurationSec),
		MOS:        res.Aggregate.MOSMean,
		LossPct:    res.Aggregate.LossPct,
		Pass:       res.Aggregate.Pass,
	}
}

// ---- helpers ----------------------------------------------------------------

func (s *Server) get(code string) *Test {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.tests[code]
}

func (s *Server) uniqueCode() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for {
		c := protocol.GenerateCode()
		if _, exists := s.tests[c]; !exists {
			return c
		}
	}
}

// mediaHost returns the host to advertise for media: the configured advertise
// value, or the hostname the client used to reach the API.
func (s *Server) mediaHost(r *http.Request) string {
	if s.opts.Advertise != "" {
		return s.opts.Advertise
	}
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		return h
	}
	return host
}

// janitor expires stuck tests and frees their media ports.
func (s *Server) janitor() {
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for range tick.C {
		now := time.Now()
		var expired bool
		s.mu.Lock()
		for _, t := range s.tests {
			t.mu.Lock()
			switch t.State {
			case protocol.StateCreated, protocol.StateClaimed:
				// Never claimed/started within a generous window.
				if now.Sub(t.CreatedAt) > 10*time.Minute {
					t.State = protocol.StateExpired
					t.closeMedia()
					expired = true
				}
			case protocol.StateRunning:
				// Running but stats went silent well past the expected end.
				deadline := time.Duration(t.Config.DurationSec+30) * time.Second
				if now.Sub(t.lastStats) > 30*time.Second && now.Sub(t.StartedAt) > deadline {
					t.State = protocol.StateExpired
					t.closeMedia()
					expired = true
				}
			case protocol.StateComplete:
				t.closeMedia() // media no longer needed once complete
			}
			t.mu.Unlock()
		}
		s.mu.Unlock()
		if expired {
			s.broadcastList()
		}
	}
}

func normalizeConfig(c *protocol.TestConfig) error {
	// Test-level transport.
	switch c.Transport {
	case protocol.TransportUDP, protocol.TransportTCP:
	case "":
		c.Transport = protocol.TransportUDP
	default:
		return fmt.Errorf("unknown transport %q (want udp or tcp)", c.Transport)
	}
	if c.DSCP < 0 || c.DSCP > 63 {
		return fmt.Errorf("dscp must be 0..63 (got %d)", c.DSCP)
	}
	if c.DurationSec < 1 {
		return fmt.Errorf("duration_sec must be >= 1")
	}

	// Fold single-profile shorthand into a Profiles list.
	if len(c.Profiles) == 0 {
		c.Profiles = []protocol.Profile{{
			Codec:       c.Codec,
			Channels:    c.Channels,
			PtimeMs:     c.PtimeMs,
			BitrateKbps: c.BitrateKbps,
		}}
	}
	// Clear the shorthand so the canonical representation is Profiles only.
	c.Codec, c.Channels, c.PtimeMs, c.BitrateKbps = "", 0, 0, 0

	total := 0
	for i := range c.Profiles {
		p := &c.Profiles[i]
		switch p.Codec {
		case protocol.CodecG711, protocol.CodecG729, protocol.CodecG722, protocol.CodecOpus:
		case "":
			p.Codec = protocol.CodecG711
		default:
			return fmt.Errorf("profile %d: unknown codec %q (want g711, g729, g722 or opus)", i, p.Codec)
		}
		if p.Codec == protocol.CodecOpus {
			switch {
			case p.BitrateKbps == 0:
				p.BitrateKbps = codec.DefaultOpusKbps
			case p.BitrateKbps < 6 || p.BitrateKbps > 510:
				return fmt.Errorf("profile %d: bitrate_kbps for opus must be 6..510 (got %d)", i, p.BitrateKbps)
			}
		} else {
			p.BitrateKbps = 0
		}
		switch p.PtimeMs {
		case 0:
			p.PtimeMs = 20
		case 10, 20, 30:
		default:
			return fmt.Errorf("profile %d: ptime_ms must be 10, 20 or 30 (got %d)", i, p.PtimeMs)
		}
		if p.Channels < 1 {
			return fmt.Errorf("profile %d: channels must be >= 1", i)
		}
		total += p.Channels
	}
	if total > 5000 {
		return fmt.Errorf("total channels %d across %d profile(s) exceeds sane limit (5000)", total, len(c.Profiles))
	}

	dt := protocol.DefaultThresholds()
	if c.Thresholds.LossPct == 0 {
		c.Thresholds.LossPct = dt.LossPct
	}
	if c.Thresholds.JitterMs == 0 {
		c.Thresholds.JitterMs = dt.JitterMs
	}
	if c.Thresholds.OneWayMs == 0 {
		c.Thresholds.OneWayMs = dt.OneWayMs
	}
	if c.Thresholds.MOS == 0 {
		c.Thresholds.MOS = dt.MOS
	}
	return nil
}

func clientIP(r *http.Request) string {
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return h
	}
	return r.RemoteAddr
}

func sseHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
}

func writeSSE(w http.ResponseWriter, data []byte) {
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, status int, format string, a ...any) {
	writeJSON(w, status, map[string]string{"error": fmt.Sprintf(format, a...)})
}
