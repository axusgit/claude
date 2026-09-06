// Package qos sets the IP DiffServ code point (DSCP) on a socket so the RTP it
// sends is marked for QoS treatment by the network (e.g. EF / DSCP 46 for
// voice). It is used on both sides: the probe marks the packets it sends and
// the collector marks the echoes it returns, so QoS can be exercised in both
// directions of the simulated call.
//
// IMPORTANT platform note: on Linux (the usual collector host, and the probe
// when run there) this genuinely marks packets. On Windows the setsockopt call
// typically SUCCEEDS but the OS ignores the value — since Windows XP SP2 the
// TCP/IP stack does not honour a user-set IP_TOS/DSCP unless it is applied
// through the qWAVE API or a QoS Group Policy. So a DSCP set on the Windows
// probe will usually leave packets marked best-effort. This is a Windows
// limitation, not a bug in the tool; it is called out in the report/dashboard.
package qos

import "syscall"

// SetDSCP marks outgoing packets on the socket behind rc with the given DSCP
// (0..63), shifted into the TOS/Traffic-Class byte. dscp <= 0 is a no-op. The
// marking is best effort: it targets both IPv4 (IP_TOS) and IPv6 (IPV6_TCLASS)
// and never fails the caller for a socket family that rejects one of them.
func SetDSCP(rc syscall.RawConn, dscp int) error {
	if dscp <= 0 || rc == nil {
		return nil
	}
	return rc.Control(func(fd uintptr) {
		setTOS(fd, dscp<<2)
	})
}
