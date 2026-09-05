// Package emodel implements the ITU-T G.107 E-model transmission-rating
// calculation and the G.107 R->MOS mapping. We deliberately use the standard
// model rather than an invented formula: R-factor from one-way delay plus
// effective (burst-aware) loss, with codec-appropriate Ie/Bpl values.
package emodel

// R computes the E-model transmission rating factor.
//
//	R = R0 - Is - Id - Ie_eff + A
//
// with:
//   - R0 = 93.2 (default basic signal-to-noise), Is = 0, A = 0 (no advantage factor)
//   - Id  = delay impairment from the one-way (mouth-to-ear) delay
//   - Ie_eff = Ie + (95 - Ie) * Ppl / (Ppl/BurstR + Bpl)
//
// oneWayMs is the mouth-to-ear delay in ms, lossPct is packet loss probability
// in percent (0..100), burstR is the burst ratio (>= 1; 1 = random loss), and
// ie/bpl are the codec's impairment values.
func R(oneWayMs, lossPct, burstR, ie, bpl float64) float64 {
	const r0 = 93.2
	const is = 0.0
	const a = 0.0

	if burstR < 1 {
		burstR = 1
	}
	id := delayImpairment(oneWayMs)

	ppl := lossPct
	if ppl < 0 {
		ppl = 0
	}
	ieEff := ie + (95-ie)*(ppl/(ppl/burstR+bpl))

	r := r0 - is - id - ieEff + a
	if r < 0 {
		return 0
	}
	if r > 100 {
		return 100
	}
	return r
}

// delayImpairment is the widely-used simplified E-model delay term:
//
//	Id = 0.024*d + 0.11*(d - 177.3)*H(d - 177.3)
//
// where H is the Heaviside step. Below ~177 ms the impairment is linear; above
// it, an additional steeper penalty applies.
func delayImpairment(d float64) float64 {
	if d <= 0 {
		return 0
	}
	id := 0.024 * d
	if d > 177.3 {
		id += 0.11 * (d - 177.3)
	}
	return id
}

// MOS maps an R-factor to a Mean Opinion Score using the G.107 formula:
//
//	MOS = 1 + 0.035R + 7e-6 * R(R-60)(100-R)
//
// clamped to the [1, 4.5] range the model can produce.
func MOS(r float64) float64 {
	if r < 0 {
		return 1
	}
	if r > 100 {
		return 4.5
	}
	m := 1 + 0.035*r + 7e-6*r*(r-60)*(100-r)
	if m < 1 {
		return 1
	}
	if m > 4.5 {
		return 4.5
	}
	return m
}
