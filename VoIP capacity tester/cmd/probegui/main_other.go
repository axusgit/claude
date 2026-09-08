//go:build !windows

// The GUI probe is Windows-only (system tray, shutdown-block, native widgets).
// This stub keeps `go build ./...` and `go test ./...` working on other OSes.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "probegui is Windows-only; use the console 'probe' on this platform.")
	os.Exit(1)
}
