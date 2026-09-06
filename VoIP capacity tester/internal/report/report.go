// Package report renders a completed test into the three required forms:
// a human-readable text report (3 tiers: header, aggregate, per-channel table),
// a machine-readable JSON payload, and a per-channel CSV.
package report

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"time"

	"voiptest/internal/protocol"
)

// Result is the fully-assembled outcome of a test.
type Result struct {
	Code        string                  `json:"code"`
	GeneratedAt time.Time               `json:"generated_at"`
	ClientID    string                  `json:"client_id"`
	ClientIP    string                  `json:"client_ip"`
	Config      protocol.TestConfig     `json:"config"`
	Aggregate   protocol.Aggregate      `json:"aggregate"`
	Channels    []protocol.ChannelStats `json:"channels"`

	// Per-direction (one-way) breakdown. Populated when a collector measured the
	// forward leg; may be empty for a purely client-side report.
	ForwardAgg protocol.DirectionAggregate `json:"forward_agg"`
	ReturnAgg  protocol.DirectionAggregate `json:"return_agg"`
	Forward    []protocol.DirectionStats   `json:"forward,omitempty"`
	Return     []protocol.DirectionStats   `json:"return,omitempty"`
}

// WriteJSON emits the machine-readable payload.
func WriteJSON(w io.Writer, r Result) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

// WriteCSV emits one row per channel.
func WriteCSV(w io.Writer, r Result) error {
	cw := csv.NewWriter(w)
	header := []string{
		"channel", "verdict", "loss_pct", "lost", "burst_count", "isolated_loss",
		"longest_burst", "reordered", "duplicates", "jitter_ms", "jitter_max_ms",
		"jitter_p95_ms", "rtt_min_ms", "rtt_mean_ms", "rtt_max_ms", "rtt_p95_ms",
		"oneway_ms", "fwd_loss_pct", "fwd_jitter_ms", "ret_loss_pct",
		"packets_sent", "packets_recv", "bitrate_kbps",
		"expected_kbps", "r_factor", "mos",
	}
	if err := cw.Write(header); err != nil {
		return err
	}
	fwdBy := indexDirection(r.Forward)
	retBy := indexDirection(r.Return)
	chans := sortedChannels(r.Channels)
	for _, c := range chans {
		fd := fwdBy[c.Channel]
		rd := retBy[c.Channel]
		row := []string{
			itoa(int64(c.Channel)), pass(c.Pass), f(c.LossPct), itoa(c.Lost),
			itoa(c.BurstCount), itoa(c.IsolatedLoss), itoa(c.LongestBurst),
			itoa(c.Reordered), itoa(c.Duplicates), f(c.JitterMs), f(c.JitterMaxMs),
			f(c.JitterP95Ms), f(c.RTTMinMs), f(c.RTTMeanMs), f(c.RTTMaxMs),
			f(c.RTTP95Ms), f(c.OneWayMs), f(fd.LossPct), f(fd.JitterMs), f(rd.LossPct),
			itoa(c.PacketsSent), itoa(c.PacketsRecv),
			f(c.BitrateKbps), f(c.ExpectedKbps), f(c.RFactor), f(c.MOS),
		}
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// WriteText emits the tiered human-readable report.
func WriteText(w io.Writer, r Result) error {
	p := func(format string, a ...any) { fmt.Fprintf(w, format, a...) }
	cfg := r.Config
	agg := r.Aggregate

	// ---- Tier 1: HEADER ------------------------------------------------------
	p("================================================================================\n")
	p("  VoIP CAPACITY TEST REPORT\n")
	p("================================================================================\n")
	p("  Verdict:      %s\n", verdictBanner(agg.Pass))
	p("  Test CODE:    %s\n", r.Code)
	p("  Generated:    %s\n", r.GeneratedAt.Format(time.RFC3339))
	p("  Client:       %s (%s)\n", r.ClientID, r.ClientIP)
	p("  Transport:    %s        Duration: %d s        Total channels: %d\n",
		up(string(cfg.Transport)), cfg.DurationSec, cfg.TotalChannels())
	for i, pr := range cfg.Profiles {
		p("  Profile %d:    %s × %d   ptime %d ms\n", i, profileLabel(pr), pr.Channels, pr.PtimeMs)
	}
	p("  QoS (DSCP):   %s\n", dscpLabel(cfg.DSCP))
	p("  Thresholds:   loss<%.2g%%  jitter<%gms  one-way<%gms  MOS>=%.2g\n",
		cfg.Thresholds.LossPct, cfg.Thresholds.JitterMs, cfg.Thresholds.OneWayMs, cfg.Thresholds.MOS)
	if cfg.Transport == protocol.TransportTCP {
		p("  NOTE: TCP transport — RFC 4571 framed, one connection per channel.\n")
		p("        Retransmits and Nagle inflate jitter/RTT and mask loss vs UDP.\n")
	}
	p("\n")

	// ---- Tier 2: AGGREGATE ---------------------------------------------------
	p("--------------------------------------------------------------------------------\n")
	p("  AGGREGATE (across %d channels)\n", agg.Channels)
	p("--------------------------------------------------------------------------------\n")
	p("  Packets:   sent %d   recv %d   lost %d   (loss %.3f%%)\n",
		agg.PacketsSent, agg.PacketsRecv, agg.TotalLost, agg.LossPct)
	p("  Loss dist: bursts %d   isolated %d   longest burst %d   reordered %d   dup %d\n",
		agg.BurstCount, agg.IsolatedLoss, agg.LongestBurst, agg.Reordered, agg.Duplicates)
	p("  Jitter:    mean %.2f ms   max %.2f ms   p95 %.2f ms\n",
		agg.JitterMeanMs, agg.JitterMaxMs, agg.JitterP95Ms)
	p("  RTT:       min %.2f   mean %.2f   max %.2f   p95 %.2f ms\n",
		agg.RTTMinMs, agg.RTTMeanMs, agg.RTTMaxMs, agg.RTTP95Ms)
	p("  One-way:   %.2f ms (estimated as RTT/2; clocks not assumed synced)\n", agg.OneWayMs)
	p("  Bitrate:   achieved %.1f kbps   expected %.1f kbps (IP layer)\n",
		agg.BitrateKbps, agg.ExpectedKbps)
	p("  Quality:   R-factor %.1f (mean)   MOS %.2f (mean)   MOS %.2f (worst)\n",
		agg.RFactorMean, agg.MOSMean, agg.MOSMin)
	p("  Worst channel: #%d\n", agg.WorstChan)
	p("\n")

	// ---- Tier 2b: PER-DIRECTION (one-way) -----------------------------------
	// Present only when a collector measured the forward leg. Loss is separated
	// into the two legs; forward jitter is a true one-way RFC 3550 measurement.
	if fa := r.ForwardAgg; fa.Recv+fa.Lost > 0 {
		ra := r.ReturnAgg
		p("--------------------------------------------------------------------------------\n")
		p("  PER-DIRECTION (one-way, collector-measured)\n")
		p("--------------------------------------------------------------------------------\n")
		p("  Forward  (client -> collector):  recv %d  lost %d  (loss %.3f%%)  jitter mean %.2f ms  max %.2f ms\n",
			fa.Recv, fa.Lost, fa.LossPct, fa.JitterMeanMs, fa.JitterMaxMs)
		p("  Return   (collector -> client):  recv %d  lost %d  (loss %.3f%%)\n",
			ra.Recv, ra.Lost, ra.LossPct)
		p("  (Round-trip loss above combines both legs; jitter/RTT above are round-trip.)\n")
		p("\n")
	}

	// ---- Tier 2c: PER-PROFILE (mixed tests) ---------------------------------
	if len(cfg.Profiles) > 1 {
		p("--------------------------------------------------------------------------------\n")
		p("  PER-PROFILE\n")
		p("--------------------------------------------------------------------------------\n")
		p("  %-2s %-22s %5s %8s %8s %8s %6s %5s\n",
			"#", "codec", "chans", "loss%", "jit(ms)", "1way(ms)", "MOS", "pass")
		for i, pr := range cfg.Profiles {
			pa := profileAggregate(r.Channels, i)
			res := "yes"
			if !pa.pass {
				res = "NO"
			}
			p("  %-2d %-22s %5d %8.3f %8.2f %8.2f %6.2f %5s\n",
				i, profileLabel(pr), pa.count, pa.lossPct, pa.jitterMs, pa.oneWayMs, pa.mosMean, res)
		}
		p("\n")
	}

	// ---- Tier 3: PER-CHANNEL TABLE ------------------------------------------
	p("--------------------------------------------------------------------------------\n")
	p("  PER-CHANNEL\n")
	p("--------------------------------------------------------------------------------\n")
	p("  %-4s %-6s %8s %8s %8s %8s %8s %6s %5s\n",
		"chan", "result", "loss%", "jit(ms)", "rtt(ms)", "1way(ms)", "kbps", "R", "MOS")
	for _, c := range sortedChannels(r.Channels) {
		res := "PASS"
		if !c.Pass {
			res = "FAIL"
		}
		p("  %-4d %-6s %8.3f %8.2f %8.2f %8.2f %8.1f %6.1f %5.2f",
			c.Channel, res, c.LossPct, c.JitterMs, c.RTTMeanMs, c.OneWayMs,
			c.BitrateKbps, c.RFactor, c.MOS)
		if !c.Pass && len(c.FailReasons) > 0 {
			p("   <- %v", c.FailReasons)
		}
		p("\n")
	}
	p("================================================================================\n")
	return nil
}

// profileAgg is a small per-profile roll-up for the mixed-test breakdown.
type profileAgg struct {
	count             int
	lossPct           float64
	jitterMs          float64
	oneWayMs          float64
	mosMean           float64
	pass              bool
}

// profileAggregate rolls up the channels belonging to one profile.
func profileAggregate(chans []protocol.ChannelStats, profileID int) profileAgg {
	pa := profileAgg{pass: true}
	var jitSum, owSum, mosSum float64
	var recv, lost int64
	for _, c := range chans {
		if c.ProfileID != profileID {
			continue
		}
		pa.count++
		recv += c.PacketsRecv
		lost += c.Lost
		jitSum += c.JitterMs
		owSum += c.OneWayMs
		mosSum += c.MOS
		if !c.Pass {
			pa.pass = false
		}
	}
	if pa.count == 0 {
		return pa
	}
	if d := recv + lost; d > 0 {
		pa.lossPct = 100 * float64(lost) / float64(d)
	}
	n := float64(pa.count)
	pa.jitterMs = jitSum / n
	pa.oneWayMs = owSum / n
	pa.mosMean = mosSum / n
	return pa
}

// indexDirection maps channel index -> its one-way stats for quick joins.
func indexDirection(ds []protocol.DirectionStats) map[int]protocol.DirectionStats {
	m := make(map[int]protocol.DirectionStats, len(ds))
	for _, d := range ds {
		m[d.Channel] = d
	}
	return m
}

func sortedChannels(in []protocol.ChannelStats) []protocol.ChannelStats {
	out := make([]protocol.ChannelStats, len(in))
	copy(out, in)
	sort.Slice(out, func(i, j int) bool { return out[i].Channel < out[j].Channel })
	return out
}

// profileLabel is a friendly codec name for a profile, including Opus bitrate.
func profileLabel(p protocol.Profile) string {
	switch p.Codec {
	case protocol.CodecG729:
		return "G.729"
	case protocol.CodecG722:
		return "G.722 (wideband)"
	case protocol.CodecOpus:
		kbps := p.BitrateKbps
		if kbps == 0 {
			kbps = 32
		}
		return fmt.Sprintf("Opus %dk (wideband)", kbps)
	case protocol.CodecG711:
		return "G.711 u-law"
	default:
		return string(p.Codec)
	}
}

// dscpLabel describes a DSCP value for the report header.
func dscpLabel(dscp int) string {
	if dscp <= 0 {
		return "0 (best effort / CS0)"
	}
	name := ""
	switch dscp {
	case 46:
		name = " (EF — expedited forwarding, voice)"
	case 34:
		name = " (AF41)"
	case 26:
		name = " (AF31)"
	case 24:
		name = " (CS3)"
	}
	return fmt.Sprintf("%d%s — NOTE: Windows usually ignores a user-set DSCP; effective on Linux", dscp, name)
}

func verdictBanner(pass bool) string {
	if pass {
		return "*** PASS ***"
	}
	return "*** FAIL ***"
}

func pass(b bool) string {
	if b {
		return "PASS"
	}
	return "FAIL"
}

func up(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 32
		}
	}
	return string(b)
}

func itoa(v int64) string  { return strconv.FormatInt(v, 10) }
func f(v float64) string   { return strconv.FormatFloat(v, 'f', 3, 64) }
