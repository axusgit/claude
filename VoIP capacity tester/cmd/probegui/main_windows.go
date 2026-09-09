//go:build windows

// Command probegui is a resident, GUI front-end for the VoIP capacity probe.
//
// A technician launches it once at a site and leaves it running. It stays up in
// the Windows system tray until the PC is rebooted:
//
//   - Closing the window (the X) hides it to the tray; the probe keeps running.
//   - Quitting for real is only possible from the tray menu's "Exit", which
//     first asks for confirmation.
//   - If Windows is asked to shut down or reboot, the probe blocks the shutdown
//     and Windows shows a warning naming this app, so an in-progress (or standing)
//     test session is never killed silently.
//
// To run a test the tech pastes the CODE the admin gave them and clicks Run.
// The collector URL can be baked in at build time so only the CODE is needed:
//
//	go build -ldflags "-H windowsgui -X main.defaultServer=https://voiptest.axustechnologies.com" ./cmd/probegui
package main

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/lxn/walk"
	dcl "github.com/lxn/walk/declarative"
	"github.com/lxn/win"

	"voiptest/internal/client"
	"voiptest/internal/probecfg"
	"voiptest/internal/protocol"
)

// defaultServer is the collector URL used to prefill the field. Bake it at build
// time with -ldflags "-X main.defaultServer=https://voiptest.axustechnologies.com".
var defaultServer = "http://127.0.0.1:8080"

// user32 entry points for the Windows shutdown-block API (not in lxn/win).
var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	procShutdownBlockReasonCreate  = user32.NewProc("ShutdownBlockReasonCreate")
	procShutdownBlockReasonDestroy = user32.NewProc("ShutdownBlockReasonDestroy")
)

const shutdownReason = "A VoIP capacity test session is running. Reboot will stop it — close it from the tray first."

// app holds the widget references and run state shared across the UI callbacks.
type app struct {
	mw       *walk.MainWindow
	ni       *walk.NotifyIcon
	server   *walk.LineEdit
	code     *walk.LineEdit
	runBtn   *walk.PushButton
	status   *walk.Label
	progress *walk.ProgressBar
	bwGauge  *walk.CustomWidget
	logView  *walk.TextEdit

	// Live bandwidth-gauge values (written on the UI thread via Synchronize, read
	// by the paint handler on the UI thread — no locking needed).
	bwTotal, bwMax, bwSend, bwRecv float64

	mu       sync.Mutex
	running  bool // a test is currently in progress
	exiting  bool // user confirmed a real exit; let the window close

	origWndProc uintptr // original window proc, for subclass chaining
}

var a = &app{}

func main() {
	if err := (dcl.MainWindow{
		AssignTo: &a.mw,
		Title:    "VoIP Capacity Probe",
		MinSize:  dcl.Size{Width: 520, Height: 460},
		Size:     dcl.Size{Width: 560, Height: 560},
		Layout:   dcl.VBox{},
		Children: []dcl.Widget{
			dcl.Composite{
				Layout: dcl.Grid{Columns: 2},
				Children: []dcl.Widget{
					dcl.Label{Text: "Collector:"},
					dcl.LineEdit{AssignTo: &a.server, Text: defaultServer},
					dcl.Label{Text: "Test CODE:"},
					dcl.LineEdit{AssignTo: &a.code, MaxLength: 16, OnKeyDown: func(key walk.Key) {
						if key == walk.KeyReturn {
							a.onRun()
						}
					}},
				},
			},
			dcl.Composite{
				Layout: dcl.HBox{MarginsZero: true},
				Children: []dcl.Widget{
					dcl.PushButton{AssignTo: &a.runBtn, Text: "Run test", OnClicked: a.onRun},
					dcl.PushButton{Text: "Open reports folder", OnClicked: a.openReports},
					dcl.HSpacer{},
				},
			},
			dcl.ProgressBar{AssignTo: &a.progress},
			dcl.CustomWidget{
				AssignTo:            &a.bwGauge,
				MinSize:             dcl.Size{Width: 260, Height: 150},
				MaxSize:             dcl.Size{Height: 160},
				ClearsBackground:    true,
				InvalidatesOnResize: true,
				Paint:               a.paintBwGauge,
			},
			dcl.Label{AssignTo: &a.status, Text: "Idle — enter a CODE and click Run."},
			dcl.TextEdit{AssignTo: &a.logView, ReadOnly: true, VScroll: true},
		},
	}).Create(); err != nil {
		fatal(err)
	}

	// System-tray icon + menu.
	ni, err := walk.NewNotifyIcon(a.mw)
	if err != nil {
		fatal(err)
	}
	a.ni = ni
	_ = ni.SetIcon(walk.IconApplication())
	_ = ni.SetToolTip("VoIP Capacity Probe — running")
	_ = ni.SetVisible(true)

	openAct := walk.NewAction()
	_ = openAct.SetText("Open")
	openAct.Triggered().Attach(a.showWindow)
	_ = ni.ContextMenu().Actions().Add(openAct)

	runAct := walk.NewAction()
	_ = runAct.SetText("Run test…")
	runAct.Triggered().Attach(func() { a.showWindow(); a.onRun() })
	_ = ni.ContextMenu().Actions().Add(runAct)

	sep := walk.NewSeparatorAction()
	_ = ni.ContextMenu().Actions().Add(sep)

	exitAct := walk.NewAction()
	_ = exitAct.SetText("Exit")
	exitAct.Triggered().Attach(a.onExit)
	_ = ni.ContextMenu().Actions().Add(exitAct)

	// Left-click the tray icon restores the window.
	ni.MouseUp().Attach(func(x, y int, button walk.MouseButton) {
		if button == walk.LeftButton {
			a.showWindow()
		}
	})

	// The X button hides to the tray instead of quitting (unless we're really
	// exiting via the tray's Exit action).
	a.mw.Closing().Attach(func(canceled *bool, reason walk.CloseReason) {
		if a.exiting {
			return
		}
		*canceled = true
		a.mw.Hide()
		_ = a.ni.ShowInfo("Still running", "The VoIP probe is still running in the tray. Use the tray icon's Exit to stop it.")
	})

	// Subclass the window so we can block system shutdown/reboot with a warning.
	a.installShutdownGuard()

	// If this .exe was downloaded pre-bound to a test (config trailer appended by
	// the collector), fill in the server + CODE and connect automatically — the
	// technician just runs it.
	a.applyEmbeddedConfig()

	defer ni.Dispose()
	a.mw.Run()
}

// installShutdownGuard registers a shutdown-block reason and subclasses the
// window proc so a shutdown/reboot request is vetoed. Windows then shows its
// "this app is preventing shutdown" screen naming this probe and the reason,
// which is the warning the operator sees before a reboot can kill a test.
func (a *app) installShutdownGuard() {
	hwnd := a.mw.Handle()
	shutdownBlockCreate(hwnd, shutdownReason)
	a.origWndProc = win.GetWindowLongPtr(hwnd, win.GWLP_WNDPROC)
	win.SetWindowLongPtr(hwnd, win.GWLP_WNDPROC, syscall.NewCallback(a.wndProc))
}

func (a *app) wndProc(hwnd win.HWND, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case win.WM_QUERYENDSESSION:
		// Returning FALSE vetoes the shutdown; Windows shows the block reason.
		shutdownBlockCreate(hwnd, shutdownReason)
		return 0
	case win.WM_ENDSESSION:
		// If the user chose "shut down anyway", allow the process to end.
		return 0
	}
	return win.CallWindowProc(a.origWndProc, hwnd, msg, wParam, lParam)
}

// applyEmbeddedConfig pre-fills the fields from a config trailer baked into this
// downloaded .exe and, when a CODE is present, auto-starts the test after a short
// grace so the window is visible first.
func (a *app) applyEmbeddedConfig() {
	// Two sources, in order of authority:
	//  1. The filename (voiptesterprobe-<CODE>.exe) — used for SIGNED downloads,
	//     whose bytes must stay untouched, so the CODE can only ride in the name.
	//  2. An appended config trailer — used for UNSIGNED downloads; also carries
	//     the collector URL and survives a browser rename.
	cfg, ok := probecfg.FromSelf()
	if exe, err := os.Executable(); err == nil {
		if code := probecfg.CodeFromName(filepath.Base(exe)); code != "" {
			cfg.Code = code
			ok = true
		}
	}
	if !ok {
		return
	}
	if cfg.Server != "" {
		_ = a.server.SetText(cfg.Server) // else the baked default stays in the field
	}
	if cfg.Code != "" {
		_ = a.code.SetText(strings.ToUpper(strings.TrimSpace(cfg.Code)))
	}
	if cfg.Code == "" {
		return
	}
	_ = a.status.SetText("Pre-loaded with CODE " + cfg.Code + " — connecting…")
	a.appendLog("This probe was downloaded pre-loaded with CODE " + cfg.Code + ". Auto-connecting…")
	go func() {
		time.Sleep(1500 * time.Millisecond)
		a.mw.Synchronize(a.onRun)
	}()
}

// onRun starts a test for the CODE in the box. It runs on a background goroutine
// and streams the probe's console output into the log view.
func (a *app) onRun() {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		walk.MsgBox(a.mw, "Test already running",
			"A test is already in progress. Wait for it to finish before starting another.",
			walk.MsgBoxIconWarning)
		return
	}
	a.mu.Unlock()

	code := strings.ToUpper(strings.TrimSpace(a.code.Text()))
	server := strings.TrimSpace(a.server.Text())
	if code == "" {
		walk.MsgBox(a.mw, "No CODE", "Enter the test CODE your admin gave you, then click Run.", walk.MsgBoxIconWarning)
		return
	}
	if server == "" {
		walk.MsgBox(a.mw, "No collector", "Enter the collector URL.", walk.MsgBoxIconWarning)
		return
	}

	a.mu.Lock()
	a.running = true
	a.mu.Unlock()

	a.runBtn.SetEnabled(false)
	_ = a.progress.SetMarqueeMode(true)
	_ = a.status.SetText("Running test " + code + " …")
	_ = a.logView.SetText("")
	a.setBandwidth(0, 0, 0, 0)
	a.appendLog("Starting test " + code + " on " + server)

	outDir := reportsDir()

	go func() {
		// Redirect the probe's stdout/stderr (this is a GUI subsystem binary with
		// no console) into a pipe and stream each line into the log view.
		r, w, _ := os.Pipe()
		oldOut, oldErr := os.Stdout, os.Stderr
		os.Stdout, os.Stderr = w, w

		scanDone := make(chan struct{})
		go func() {
			sc := bufio.NewScanner(r)
			sc.Buffer(make([]byte, 64*1024), 1024*1024)
			for sc.Scan() {
				line := sc.Text()
				a.mw.Synchronize(func() { a.appendLog(line) })
			}
			close(scanDone)
		}()

		err := client.Run(client.Options{
			ServerURL:      server,
			Code:           code,
			ClientID:       clientID(),
			OutDir:         outDir,
			ReportInterval: time.Second,
			OnProgress: func(_ float64, agg protocol.Aggregate) {
				send := agg.ExpectedKbps / 1000 // upstream sent (nominal IP-layer)
				recv := agg.BitrateKbps / 1000  // downstream echoes received
				total := send + recv
				mx := niceMax(math.Max(send*2, total) * 1.05)
				a.mw.Synchronize(func() { a.setBandwidth(total, mx, send, recv) })
			},
		})

		_ = w.Close()
		<-scanDone
		os.Stdout, os.Stderr = oldOut, oldErr

		a.mw.Synchronize(func() {
			a.mu.Lock()
			a.running = false
			a.mu.Unlock()
			a.runBtn.SetEnabled(true)
			_ = a.progress.SetMarqueeMode(false)
			a.progress.SetValue(0)
			if err != nil {
				_ = a.status.SetText("Last test FAILED — see log.")
				a.appendLog("ERROR: " + err.Error())
				_ = a.ni.ShowError("VoIP test failed", err.Error())
			} else {
				_ = a.status.SetText("Idle — last test complete. Reports in " + outDir)
				a.appendLog("Reports written to " + outDir)
				_ = a.ni.ShowInfo("VoIP test complete", "CODE "+code+" finished. Reports saved to "+outDir)
			}
		})
	}()
}

// setBandwidth stores the live gauge values and repaints (call on the UI thread).
func (a *app) setBandwidth(total, max, send, recv float64) {
	a.bwTotal, a.bwMax, a.bwSend, a.bwRecv = total, max, send, recv
	if a.bwGauge != nil {
		_ = a.bwGauge.Invalidate()
	}
}

// niceMax rounds up to a "nice" gauge maximum (1/2/2.5/5 × 10^n).
func niceMax(x float64) float64 {
	if x <= 0 {
		return 1
	}
	p := math.Pow(10, math.Floor(math.Log10(x)))
	switch n := x / p; {
	case n <= 1:
		return 1 * p
	case n <= 2:
		return 2 * p
	case n <= 2.5:
		return 2.5 * p
	case n <= 5:
		return 5 * p
	default:
		return 10 * p
	}
}

// paintBwGauge draws the semicircular send+receive bandwidth needle gauge.
func (a *app) paintBwGauge(canvas *walk.Canvas, _ walk.Rectangle) error {
	b := a.bwGauge.ClientBounds()
	cx := b.Width / 2
	cy := b.Height - 22
	r := b.Width/2 - 24
	if h := b.Height - 34; r > h {
		r = h
	}
	if r < 10 {
		return nil
	}

	colTrack := walk.RGB(0xd7, 0xdd, 0xe4)
	colSend := walk.RGB(0xf9, 0x73, 0x16)
	colRecv := walk.RGB(0x2f, 0x81, 0xf6)
	colInk := walk.RGB(0x24, 0x2a, 0x31)
	colMuted := walk.RGB(0x6a, 0x73, 0x7d)

	arcPts := func(f0, f1 float64, rr int, n int) []walk.Point {
		pts := make([]walk.Point, 0, n+1)
		for i := 0; i <= n; i++ {
			f := f0 + (f1-f0)*float64(i)/float64(n)
			th := math.Pi * (1 - f)
			pts = append(pts, walk.Point{
				X: cx + int(float64(rr)*math.Cos(th)+0.5),
				Y: cy - int(float64(rr)*math.Sin(th)+0.5),
			})
		}
		return pts
	}
	drawArc := func(f0, f1 float64, col walk.Color, width int) {
		if f1 <= f0 {
			return
		}
		br, err := walk.NewSolidColorBrush(col)
		if err != nil {
			return
		}
		defer br.Dispose()
		pen, err := walk.NewGeometricPen(walk.PenSolid|walk.PenCapRound, width, br)
		if err != nil {
			return
		}
		defer pen.Dispose()
		_ = canvas.DrawPolyline(pen, arcPts(f0, f1, r, segs(f1-f0)))
	}

	// Track + send/receive fills.
	drawArc(0, 1, colTrack, 12)
	max := a.bwMax
	var fs, ft float64
	if max > 0 {
		fs = clamp01(a.bwSend / max)
		ft = clamp01(a.bwTotal / max)
	}
	drawArc(0, fs, colSend, 12)
	drawArc(fs, ft, colRecv, 12)

	// Needle.
	th := math.Pi * (1 - ft)
	nx := cx + int(float64(r-14)*math.Cos(th)+0.5)
	ny := cy - int(float64(r-14)*math.Sin(th)+0.5)
	if nbr, err := walk.NewSolidColorBrush(colInk); err == nil {
		defer nbr.Dispose()
		if npen, err := walk.NewGeometricPen(walk.PenSolid|walk.PenCapRound, 3, nbr); err == nil {
			defer npen.Dispose()
			_ = canvas.DrawLine(npen, walk.Point{X: cx, Y: cy}, walk.Point{X: nx, Y: ny})
		}
		_ = canvas.FillEllipse(nbr, walk.Rectangle{X: cx - 5, Y: cy - 5, Width: 10, Height: 10})
	}

	// Text: big total, unit, and 0 / max tick labels.
	bigFont, _ := walk.NewFont("Segoe UI", 15, walk.FontBold)
	smFont, _ := walk.NewFont("Segoe UI", 8, 0)
	if bigFont != nil {
		defer bigFont.Dispose()
		_ = canvas.DrawText(fmt.Sprintf("%.2f", a.bwTotal), bigFont, colInk,
			walk.Rectangle{X: cx - 70, Y: cy - 50, Width: 140, Height: 26}, walk.TextCenter)
	}
	if smFont != nil {
		defer smFont.Dispose()
		_ = canvas.DrawText("Mbps total", smFont, colMuted,
			walk.Rectangle{X: cx - 70, Y: cy - 26, Width: 140, Height: 14}, walk.TextCenter)
		_ = canvas.DrawText("0", smFont, colMuted,
			walk.Rectangle{X: cx - r - 10, Y: cy, Width: 20, Height: 14}, walk.TextCenter)
		_ = canvas.DrawText(trimNum(max), smFont, colMuted,
			walk.Rectangle{X: cx + r - 10, Y: cy, Width: 24, Height: 14}, walk.TextCenter)
	}
	return nil
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// segs picks a point count for an arc span (smoother for larger spans).
func segs(span float64) int {
	n := int(span * 60)
	if n < 2 {
		n = 2
	}
	return n
}

// trimNum formats a float without trailing zeros (e.g. 2.5, 6, 0.75).
func trimNum(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	if s == "" {
		s = "0"
	}
	return s
}

// onExit is the only path to actually quit. It confirms, then tears down.
func (a *app) onExit() {
	a.mu.Lock()
	running := a.running
	a.mu.Unlock()

	msg := "Exiting stops the VoIP probe on this PC.\n\nAre you sure you want to exit?"
	if running {
		msg = "A VoIP test is CURRENTLY RUNNING. Exiting now will abort it.\n\nAre you sure you want to exit?"
	}
	if walk.MsgBox(a.mw, "Exit VoIP probe?", msg, walk.MsgBoxYesNo|walk.MsgBoxIconWarning) != walk.DlgCmdYes {
		return
	}
	a.exiting = true
	shutdownBlockDestroy(a.mw.Handle())
	_ = a.ni.SetVisible(false)
	a.mw.Close()
}

func (a *app) showWindow() {
	a.mw.Show()
	win.ShowWindow(a.mw.Handle(), win.SW_RESTORE)
	a.mw.SetFocus()
}

// appendLog appends a line to the read-only log view (call on the UI goroutine).
func (a *app) appendLog(line string) {
	a.logView.AppendText(line + "\r\n")
}

func (a *app) openReports() {
	dir := reportsDir()
	_ = os.MkdirAll(dir, 0o755)
	_ = exec.Command("explorer.exe", dir).Start()
}

// reportsDir is a "reports" folder next to the .exe, falling back to the CWD.
func reportsDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "reports"
	}
	dir := filepath.Join(filepath.Dir(exe), "reports")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func clientID() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "probe-gui"
	}
	return h
}

func shutdownBlockCreate(hwnd win.HWND, reason string) {
	p, err := syscall.UTF16PtrFromString(reason)
	if err != nil {
		return
	}
	procShutdownBlockReasonCreate.Call(uintptr(hwnd), uintptr(unsafe.Pointer(p)))
}

func shutdownBlockDestroy(hwnd win.HWND) {
	procShutdownBlockReasonDestroy.Call(uintptr(hwnd))
}

func fatal(err error) {
	walk.MsgBox(nil, "VoIP Probe — fatal error", fmt.Sprintf("%v", err), walk.MsgBoxIconError)
	os.Exit(1)
}
