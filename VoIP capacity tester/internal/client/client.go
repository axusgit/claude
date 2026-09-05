// Package client implements the probe: it claims a CODE, pulls the test config,
// generates the simulated calls as real RTP streams, measures the round trip,
// streams live stats to the collector, and writes the final report.
//
// A probe runs exactly one test per process. A process-wide guard refuses a
// second concurrent run, and the server refuses a second client claiming a CODE
// that is already active — together enforcing "one CODE = one client session".
package client

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"voiptest/internal/codec"
	"voiptest/internal/metrics"
	"voiptest/internal/protocol"
	"voiptest/internal/report"
	"voiptest/internal/rtp"
)

// Options configures a probe run.
type Options struct {
	ServerURL      string
	Code           string
	ClientID       string
	OutDir         string
	ReportInterval time.Duration
	DrainTime      time.Duration // extra time to collect in-flight echoes at end
}

// activeGuard enforces one active test per process.
var activeGuard int32

// Run executes a single test end to end.
func Run(opts Options) error {
	if !atomic.CompareAndSwapInt32(&activeGuard, 0, 1) {
		return fmt.Errorf("a test is already active in this process; one probe runs one test at a time")
	}
	defer atomic.StoreInt32(&activeGuard, 0)

	if opts.ReportInterval <= 0 {
		opts.ReportInterval = time.Second
	}
	if opts.DrainTime <= 0 {
		opts.DrainTime = 750 * time.Millisecond
	}
	opts.Code = strings.ToUpper(strings.TrimSpace(opts.Code))

	base := strings.TrimRight(opts.ServerURL, "/")

	// 1. Claim the CODE.
	claim, err := doClaim(base, opts.Code, opts.ClientID)
	if err != nil {
		return err
	}
	cfg := claim.Config
	mediaHost := claim.Media.Host
	if mediaHost == "" {
		mediaHost = hostFromURL(base) // fall back to the API host
	}
	mediaAddr := net.JoinHostPort(mediaHost, fmt.Sprintf("%d", claim.Media.Port))

	ci := codec.For(cfg.Codec)
	fmt.Printf("Claimed %s: %s %s, %d channels, ptime %dms, duration %ds\n",
		opts.Code, ci.Name, strings.ToUpper(string(cfg.Transport)), cfg.Channels, cfg.PtimeMs, cfg.DurationSec)
	fmt.Printf("Media far-end: %s (%s)\n", mediaAddr, strings.ToUpper(string(cfg.Transport)))
	if cfg.Transport == protocol.TransportTCP {
		fmt.Println("NOTE: TCP transport — jitter/RTT/loss will be distorted by retransmits and Nagle vs UDP.")
	}

	// 2. Build per-channel accumulators and run the calls.
	chans := make([]*metrics.Channel, cfg.Channels)
	for i := range chans {
		chans[i] = metrics.NewChannel(i, cfg)
	}

	start := time.Now()
	duration := time.Duration(cfg.DurationSec) * time.Second
	sendCtx, cancelSend := context.WithDeadline(context.Background(), start.Add(duration))
	defer cancelSend()

	var wg sync.WaitGroup
	closers := make([]io.Closer, cfg.Channels)
	var closersMu sync.Mutex

	for i := 0; i < cfg.Channels; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			c, err := runChannel(sendCtx, cfg, ci, mediaAddr, chans[idx], start)
			if err != nil {
				fmt.Fprintf(os.Stderr, "channel %d: %v\n", idx, err)
			}
			if c != nil {
				closersMu.Lock()
				closers[idx] = c
				closersMu.Unlock()
			}
		}(i)
	}

	// 3. Live stats reporter.
	stopReport := make(chan struct{})
	var repWG sync.WaitGroup
	repWG.Add(1)
	go func() {
		defer repWG.Done()
		ticker := time.NewTicker(opts.ReportInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stopReport:
				return
			case <-ticker.C:
				elapsed := time.Since(start).Seconds()
				postStats(base, opts.Code, opts.ClientID, elapsed, false, snapshot(chans, elapsed))
			}
		}
	}()

	// 4. Wait for the send window to end, then drain in-flight echoes.
	<-sendCtx.Done()
	time.Sleep(opts.DrainTime)

	// Stop receivers by closing sockets, then wait for goroutines.
	closersMu.Lock()
	for _, c := range closers {
		if c != nil {
			_ = c.Close()
		}
	}
	closersMu.Unlock()
	wg.Wait()

	close(stopReport)
	repWG.Wait()

	// 5. Finalize. Use the configured duration as the basis for expected-packet
	// and bitrate math so a small drain tail does not skew the rates.
	elapsed := time.Since(start).Seconds()
	finalStats := snapshot(chans, float64(cfg.DurationSec))
	postStats(base, opts.Code, opts.ClientID, elapsed, true, finalStats)

	res := report.Result{
		Code:        opts.Code,
		GeneratedAt: time.Now(),
		ClientID:    opts.ClientID,
		ClientIP:    "(this probe)",
		Config:      cfg,
		Aggregate:   metrics.Aggregate(finalStats),
		Channels:    finalStats,
	}
	printSummary(res)
	if err := writeReports(opts.OutDir, res); err != nil {
		fmt.Fprintf(os.Stderr, "writing reports: %v\n", err)
	}
	return nil
}

// runChannel sends and receives one channel's RTP stream. It returns the closer
// for the underlying socket so the caller can unblock the receiver at the end.
func runChannel(ctx context.Context, cfg protocol.TestConfig, ci codec.Info, addr string, m *metrics.Channel, start time.Time) (io.Closer, error) {
	payloadLen := ci.PayloadBytes(cfg.PtimeMs)
	if payloadLen < rtp.SendTimeSize {
		payloadLen = rtp.SendTimeSize
	}
	ssrc := rand.Uint32()
	seq := uint16(rand.Intn(1 << 16))
	ts := rand.Uint32()
	tsInc := ci.TimestampIncrement(cfg.PtimeMs)
	ptime := time.Duration(cfg.PtimeMs) * time.Millisecond

	switch cfg.Transport {
	case protocol.TransportTCP:
		conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
		if err != nil {
			return nil, fmt.Errorf("dial: %w", err)
		}
		tc := conn.(*net.TCPConn)
		go recvTCP(tc, m)
		sendLoop(ctx, start, ptime, func(pkt []byte) error {
			return rtp.WriteFramed(tc, pkt)
		}, m, ci, payloadLen, &seq, &ts, tsInc, ssrc)
		return conn, nil

	default:
		raddr, err := net.ResolveUDPAddr("udp", addr)
		if err != nil {
			return nil, err
		}
		conn, err := net.DialUDP("udp", nil, raddr)
		if err != nil {
			return nil, fmt.Errorf("dial: %w", err)
		}
		go recvUDP(conn, m)
		sendLoop(ctx, start, ptime, func(pkt []byte) error {
			_, err := conn.Write(pkt)
			return err
		}, m, ci, payloadLen, &seq, &ts, tsInc, ssrc)
		return conn, nil
	}
}

// sendLoop paces packets against an absolute schedule so pacing does not drift
// even when the OS timer is coarse (notably on Windows).
func sendLoop(ctx context.Context, start time.Time, ptime time.Duration, write func([]byte) error,
	m *metrics.Channel, ci codec.Info, payloadLen int, seq *uint16, ts *uint32, tsInc uint32, ssrc uint32) {

	pkt := make([]byte, rtp.HeaderSize+payloadLen)
	for i := rtp.HeaderSize + rtp.SendTimeSize; i < len(pkt); i++ {
		pkt[i] = 0xA5 // synthetic media filler
	}
	hdr := rtp.Header{PayloadType: ci.PayloadType, SSRC: ssrc, Marker: false}

	for n := 0; ; n++ {
		when := start.Add(time.Duration(n) * ptime)
		d := time.Until(when)
		if d > 0 {
			t := time.NewTimer(d)
			select {
			case <-ctx.Done():
				t.Stop()
				return
			case <-t.C:
			}
		} else {
			select {
			case <-ctx.Done():
				return
			default:
			}
		}

		hdr.Sequence = *seq
		hdr.Timestamp = *ts
		if n == 0 {
			hdr.Marker = true // first packet of the "talkspurt"
		} else {
			hdr.Marker = false
		}
		hdr.Marshal(pkt)
		rtp.PutSendTime(pkt[rtp.HeaderSize:], time.Now().UnixNano())

		if err := write(pkt); err != nil {
			return // socket closed / peer gone
		}
		m.IncSent()
		*seq++
		*ts += tsInc
	}
}

func recvUDP(conn *net.UDPConn, m *metrics.Channel) {
	buf := make([]byte, 2048)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			return
		}
		handlePacket(buf[:n], m)
	}
}

func recvTCP(conn *net.TCPConn, m *metrics.Channel) {
	br := bufio.NewReader(conn)
	buf := make([]byte, 2048)
	for {
		n, err := rtp.ReadFramed(br, buf)
		if err != nil {
			return
		}
		handlePacket(buf[:n], m)
	}
}

func handlePacket(pkt []byte, m *metrics.Channel) {
	now := time.Now().UnixNano()
	hdr, ok := rtp.ParseHeader(pkt)
	if !ok {
		return
	}
	sendTime := rtp.GetSendTime(pkt[rtp.HeaderSize:])
	m.OnReceive(hdr.Sequence, hdr.Timestamp, sendTime, now)
}

func snapshot(chans []*metrics.Channel, elapsed float64) []protocol.ChannelStats {
	out := make([]protocol.ChannelStats, len(chans))
	for i, c := range chans {
		out[i] = c.Snapshot(elapsed)
	}
	return out
}

// ---- HTTP control-plane calls ----------------------------------------------

var httpClient = &http.Client{Timeout: 15 * time.Second}

func doClaim(base, code, clientID string) (*protocol.ClaimResponse, error) {
	body, _ := json.Marshal(protocol.ClaimRequest{ClientID: clientID})
	req, err := http.NewRequest(http.MethodPost, base+"/api/tests/"+code+"/claim", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("contacting collector: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusConflict {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("code already in use: %s", strings.TrimSpace(string(b)))
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("claim failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var cr protocol.ClaimResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return nil, err
	}
	return &cr, nil
}

func postStats(base, code, clientID string, elapsed float64, final bool, chans []protocol.ChannelStats) {
	rep := protocol.StatsReport{
		Code:       code,
		ClientID:   clientID,
		ElapsedSec: elapsed,
		Final:      final,
		Channels:   chans,
	}
	body, _ := json.Marshal(rep)
	resp, err := httpClient.Post(base+"/api/tests/"+code+"/stats", "application/json", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(os.Stderr, "stats post failed: %v\n", err)
		return
	}
	_ = resp.Body.Close()
}

// ---- output -----------------------------------------------------------------

func printSummary(res report.Result) {
	fmt.Println()
	_ = report.WriteText(os.Stdout, res)
}

func writeReports(dir string, res report.Result) error {
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	stamp := time.Now().Format("20060102-150405")
	baseName := fmt.Sprintf("%s-%s", res.Code, stamp)

	txt, err := os.Create(filepath.Join(dir, baseName+".txt"))
	if err != nil {
		return err
	}
	defer txt.Close()
	if err := report.WriteText(txt, res); err != nil {
		return err
	}

	jf, err := os.Create(filepath.Join(dir, baseName+".json"))
	if err != nil {
		return err
	}
	defer jf.Close()
	if err := report.WriteJSON(jf, res); err != nil {
		return err
	}

	cf, err := os.Create(filepath.Join(dir, baseName+".csv"))
	if err != nil {
		return err
	}
	defer cf.Close()
	if err := report.WriteCSV(cf, res); err != nil {
		return err
	}

	fmt.Printf("\nReports written: %s.{txt,json,csv} in %s\n", baseName, dir)
	return nil
}

func hostFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "127.0.0.1"
	}
	return u.Hostname()
}
