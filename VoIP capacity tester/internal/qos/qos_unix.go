//go:build !windows

package qos

import "syscall"

// setTOS sets the TOS/Traffic-Class byte on a unix socket, best effort for both
// IPv4 and IPv6. The wrong-family call simply errors and is ignored.
func setTOS(fd uintptr, tos int) {
	_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TOS, tos)
	_ = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IPV6, syscall.IPV6_TCLASS, tos)
}
