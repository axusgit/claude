// Command probe is the VoIP capacity-test client. It compiles to a single
// Windows .exe. Given a collector URL and a test CODE it runs the simulated
// calls and reports results.
//
// Usage:
//
//	probe -server http://collector:8080 -code ABC123
//
// Convenience: if -code is omitted, probe will create a test on the collector
// from the -codec/-channels/-transport/-duration/-ptime flags, then run it.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"voiptest/internal/client"
	"voiptest/internal/protocol"
)

func main() {
	server := flag.String("server", "http://127.0.0.1:8080", "collector base URL")
	code := flag.String("code", "", "test CODE to claim (leave empty to create a test from the flags below)")
	id := flag.String("id", defaultID(), "client identity reported to the collector")
	out := flag.String("out", ".", "directory for the written report files")

	// Used only when -code is empty (create-then-run convenience).
	codec := flag.String("codec", "g711", "codec: g711, g729, g722 or opus (create mode)")
	channels := flag.Int("channels", 10, "number of concurrent channels (create mode)")
	transport := flag.String("transport", "udp", "transport: udp or tcp (create mode)")
	duration := flag.Int("duration", 30, "test duration in seconds (create mode)")
	ptime := flag.Int("ptime", 20, "packetization time ms: 10, 20 or 30 (create mode)")
	bitrate := flag.Int("bitrate", 0, "opus nominal bitrate kbps (create mode; 0 = default 32; ignored for other codecs)")
	dscp := flag.Int("dscp", 0, "DSCP value 0..63 to mark RTP with (create mode; 0 = best effort, 46 = EF). See README QoS notes.")
	flag.Parse()

	base := strings.TrimRight(*server, "/")
	testCode := strings.ToUpper(strings.TrimSpace(*code))

	if testCode == "" {
		created, err := createTest(base, protocol.TestConfig{
			Codec:       protocol.Codec(*codec),
			Channels:    *channels,
			Transport:   protocol.Transport(*transport),
			DurationSec: *duration,
			PtimeMs:     *ptime,
			BitrateKbps: *bitrate,
			DSCP:        *dscp,
		})
		if err != nil {
			fatal("create test: %v", err)
		}
		testCode = created.Code
		fmt.Printf("Created test CODE %s on %s\n", testCode, base)
	}

	err := client.Run(client.Options{
		ServerURL:      base,
		Code:           testCode,
		ClientID:       *id,
		OutDir:         *out,
		ReportInterval: time.Second,
	})
	if err != nil {
		fatal("%v", err)
	}
}

func createTest(base string, cfg protocol.TestConfig) (*protocol.CreateTestResponse, error) {
	body, _ := json.Marshal(cfg)
	resp, err := http.Post(base+"/api/tests", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var cr protocol.CreateTestResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return nil, err
	}
	return &cr, nil
}

func defaultID() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "probe"
	}
	return h
}

func fatal(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "probe: "+format+"\n", a...)
	os.Exit(1)
}
