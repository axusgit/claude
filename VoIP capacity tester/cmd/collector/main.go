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
	flag.Parse()

	s := server.New(server.Options{
		Addr:      *addr,
		MediaBind: *mediaBind,
		Advertise: *advertise,
	})
	log.Fatal(s.Run())
}
