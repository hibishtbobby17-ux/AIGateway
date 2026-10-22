package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	ErrSSRFBlocked = errors.New("SSRF policy violation: destination IP is blocked")
)

var (
	blockedMetadataCIDRs []*net.IPNet
	blockedPrivateCIDRs  []*net.IPNet
	cidrInitOnce         sync.Once
)

func initCIDRs() {
	metadataStrings := []string{
		"169.254.0.0/16", // Link-local and AWS / GCP / Azure Instance Metadata (169.254.169.254)
		"100.64.0.0/10",  // Carrier-grade NAT
		"0.0.0.0/8",      // Broadcast / unspecified
		"224.0.0.0/4",    // Multicast
		"240.0.0.0/4",    // Reserved
	}

	privateStrings := []string{
		"127.0.0.0/8",    // Loopback
		"10.0.0.0/8",     // RFC 1918 Private
		"172.16.0.0/12",  // RFC 1918 Private
		"192.168.0.0/16", // RFC 1918 Private
		"::1/128",        // IPv6 Loopback
		"fc00::/7",       // IPv6 Unique Local
		"fe80::/10",      // IPv6 Link-Local
	}

	for _, s := range metadataStrings {
		_, block, err := net.ParseCIDR(s)
		if err == nil {
			blockedMetadataCIDRs = append(blockedMetadataCIDRs, block)
		}
	}

	for _, s := range privateStrings {
		_, block, err := net.ParseCIDR(s)
		if err == nil {
			blockedPrivateCIDRs = append(blockedPrivateCIDRs, block)
		}
	}
}

// IsIPBlocked returns an error if the IP is disallowed under the current SSRF policy
func IsIPBlocked(ip net.IP, allowLocal bool) error {
	cidrInitOnce.Do(initCIDRs)

	if ip == nil {
		return ErrSSRFBlocked
	}

	// 1. Metadata ranges are NEVER permitted, even with local egress enabled
	for _, block := range blockedMetadataCIDRs {
		if block.Contains(ip) {
			return fmt.Errorf("%w: IP %s belongs to restricted cloud metadata or link-local CIDR %s", ErrSSRFBlocked, ip, block)
		}
	}

	// 2. Private & loopback ranges are blocked unless allowLocal is explicitly enabled
	if !allowLocal {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return fmt.Errorf("%w: IP %s is a private or loopback destination", ErrSSRFBlocked, ip)
		}

		for _, block := range blockedPrivateCIDRs {
			if block.Contains(ip) {
				return fmt.Errorf("%w: IP %s belongs to private CIDR %s", ErrSSRFBlocked, ip, block)
			}
		}
	}

	return nil
}

// ValidateURL validates destination URL against SSRF policy before connection
func ValidateURL(rawURL string, allowLocal bool) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("forbidden protocol %q: only http and https are allowed", scheme)
	}

	hostname := parsed.Hostname()
	if hostname == "" {
		return errors.New("missing hostname in target URL")
	}

	lowerHost := strings.ToLower(hostname)
	if strings.Contains(lowerHost, "169.254.169.254") ||
		strings.Contains(lowerHost, "metadata.google.internal") ||
		strings.Contains(lowerHost, "instance-data") {
		return fmt.Errorf("%w: access to cloud instance metadata is strictly forbidden", ErrSSRFBlocked)
	}

	// Resolve IPs
	ips, err := net.LookupIP(hostname)
	if err != nil {
		return fmt.Errorf("SSRF guard DNS resolution failed for %s: %w", hostname, err)
	}

	for _, ip := range ips {
		if err := IsIPBlocked(ip, allowLocal); err != nil {
			return err
		}
	}

	return nil
}

// SafeDialer creates a hardened net.Dialer mitigating DNS rebinding by checking resolved IP
func SafeDialContext(allowLocal bool) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}

		// Re-check environment override if not explicitly specified
		localEgress := allowLocal || os.Getenv("ALLOW_LOCAL_EGRESS") == "true"

		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, fmt.Errorf("SSRF resolver lookup failed for %s: %w", host, err)
		}

		if len(ips) == 0 {
			return nil, fmt.Errorf("no IP resolved for %s", host)
		}

		targetIP := ips[0]
		if err := IsIPBlocked(targetIP, localEgress); err != nil {
			return nil, err
		}

		targetAddr := net.JoinHostPort(targetIP.String(), port)
		return dialer.DialContext(ctx, network, targetAddr)
	}
}
