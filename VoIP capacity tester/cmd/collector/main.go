// Command collector is the VoIP capacity-test server: control API, RTP echo
// endpoints, live aggregation, SSE, and the embedded web dashboard — one binary.
package main

import (
	"flag"
	"log"

	"voiptest/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address for the control API + dashboard")
	mediaBind := flag.String("media-bind", "", "interface to bind RTP echo listeners on (default all)")
	advertise := flag.String("advertise", "", "media host to advertise to clients (default: the host the client used to reach the API)")
	dataDir := flag.String("data-dir", "", "directory to persist completed test reports for history/compare across restarts (default: in-memory only)")
	mediaPortMin := flag.Int("media-port-min", 0, "low end of the media echo port range (0 = ephemeral; set with -media-port-max so a cloud firewall can allow just that range)")
	mediaPortMax := flag.Int("media-port-max", 0, "high end of the media echo port range")
	probeExe := flag.String("probe-exe", "", "path to a probe.exe to serve at /download/probe.exe for technicians")
	flag.Parse()

	s := server.New(server.Options{
		Addr:         *addr,
		MediaBind:    *mediaBind,
		Advertise:    *advertise,
		DataDir:      *dataDir,
		MediaPortMin: *mediaPortMin,
		MediaPortMax: *mediaPortMax,
		ProbeExe:     *probeExe,
	})
	log.Fatal(s.Run())
}
