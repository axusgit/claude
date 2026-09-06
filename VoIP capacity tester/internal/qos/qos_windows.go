//go:build windows

package qos

import "syscall"

// Winsock option numbers (ws2tcpip.h). These differ from the Linux values, so
// they are declared per-platform rather than taken from package syscall.
const (
	ipTOS      = 3  // IP_TOS
	ipv6TClass = 39 // IPV6_TCLASS
)

// setTOS attempts to set the TOS/Traffic-Class byte on a Windows socket. See the
// package note: Windows usually ignores a user-set DSCP, so this is best effort
// and may have no effect on the wire even when the call succeeds.
func setTOS(fd uintptr, tos int) {
	h := syscall.Handle(fd)
	_ = syscall.SetsockoptInt(h, syscall.IPPROTO_IP, ipTOS, tos)
	_ = syscall.SetsockoptInt(h, syscall.IPPROTO_IPV6, ipv6TClass, tos)
}
