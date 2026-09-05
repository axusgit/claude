package emodel

import (
	"math"
	"testing"
)

// G.711 impairment values.
const (
	g711Ie  = 0
	g711Bpl = 25.1
	g729Ie  = 11
	g729Bpl = 19.0
)

func TestPerfectG711(t *testing.T) {
	r := R(0, 0, 1, g711Ie, g711Bpl)
	if math.Abs(r-93.2) > 0.01 {
		t.Errorf("R = %v, want 93.2 for ideal G.711", r)
	}
	mos := MOS(r)
	if mos < 4.3 || mos > 4.5 {
		t.Errorf("MOS = %v, want ~4.4 for ideal G.711", mos)
	}
}

func TestLossDegradesR(t *testing.T) {
	clean := R(0, 0, 1, g711Ie, g711Bpl)
	lossy := R(0, 5, 1, g711Ie, g711Bpl)
	if lossy >= clean {
		t.Errorf("R with 5%% loss (%v) should be below clean (%v)", lossy, clean)
	}
}

func TestBurstyLossWorseThanRandom(t *testing.T) {
	random := R(0, 3, 1, g711Ie, g711Bpl)  // burstR 1
	bursty := R(0, 3, 4, g711Ie, g711Bpl)  // burstR 4
	if bursty >= random {
		t.Errorf("bursty loss R (%v) should be worse than random (%v)", bursty, random)
	}
}

func TestDelayDegradesR(t *testing.T) {
	near := R(50, 0, 1, g711Ie, g711Bpl)
	far := R(300, 0, 1, g711Ie, g711Bpl)
	if far >= near {
		t.Errorf("R at 300ms (%v) should be below R at 50ms (%v)", far, near)
	}
}

func TestG729LowerCeilingThanG711(t *testing.T) {
	g711 := MOS(R(0, 0, 1, g711Ie, g711Bpl))
	g729 := MOS(R(0, 0, 1, g729Ie, g729Bpl))
	if g729 >= g711 {
		t.Errorf("G.729 ceiling MOS (%v) should be below G.711 (%v)", g729, g711)
	}
}

func TestMOSClamped(t *testing.T) {
	if MOS(-10) != 1 {
		t.Errorf("MOS(-10) = %v, want 1", MOS(-10))
	}
	if MOS(200) != 4.5 {
		t.Errorf("MOS(200) = %v, want 4.5", MOS(200))
	}
}
