package resilience

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var (
	ErrSSRFDestinationBlocked = errors.New("security violation: outbound destination IP is blocked by SSRF policy")
	ErrInvalidDestinationHost = errors.New("invalid destination host")
)

var (
	privateIPBlocks []*net.IPNet
	onceInitBlocks  sync.Once
)

func initPrivateCIDRs() {
	cidrs := []string{
		// IPv4 Private / Loopback / Link-Local / Metadata
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"169.254.0.0/16", // AWS / GCP / Azure Instance Metadata
		"0.0.0.0/8",
		"100.64.0.0/10", // Carrier-grade NAT
		"192.0.0.0/24",
		"192.0.2.0/24",
		"198.18.0.0/15",
		"198.51.100.0/24",
		"203.0.113.0/24",
		"224.0.0.0/4",   // Multicast
		"240.0.0.0/4",   // Reserved

		// IPv6 Private / Loopback / Link-Local
		"::1/128",
		"fc00::/7",
		"fe80::/10",
		"::/128",
	}

	for _, cidr := range cidrs {
		_, block, err := net.ParseCIDR(cidr)
		if err == nil {
			privateIPBlocks = append(privateIPBlocks, block)
		}
	}
}

// IsPrivateIP returns true if the IP falls within a non-routable, loopback, or private range.
func IsPrivateIP(ip net.IP) bool {
	onceInitBlocks.Do(initPrivateCIDRs)

	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsUnspecified() {
		return true
	}

	for _, block := range privateIPBlocks {
		if block.Contains(ip) {
			return true
		}
	}
	return false
}

// SafeDialer creates a hardened network dialer mitigating SSRF and DNS rebinding attacks.
type SafeDialer struct {
	AllowLocalEgress bool
	AllowedCIDRs     []*net.IPNet
	DialTimeout      time.Duration
}

// NewSafeDialer creates a new SafeDialer with specified security settings.
func NewSafeDialer(allowLocalEgress bool, allowedCIDRStrings []string) *SafeDialer {
	sd := &SafeDialer{
		AllowLocalEgress: allowLocalEgress,
		DialTimeout:      10 * time.Second,
	}

	for _, str := range allowedCIDRStrings {
		_, block, err := net.ParseCIDR(strings.TrimSpace(str))
		if err == nil && block != nil {
			sd.AllowedCIDRs = append(sd.AllowedCIDRs, block)
		}
	}

	return sd
}

// DialContext resolves the host, checks resolved IPs against the SSRF deny-list,
// and dials directly to the validated IP to prevent DNS rebinding.
func (sd *SafeDialer) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidDestinationHost, addr)
	}

	// 1. Resolve host to IP addresses
	resolver := net.DefaultResolver
	ips, err := resolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("failed resolving destination host %q: %w", host, err)
	}

	if len(ips) == 0 {
		return nil, fmt.Errorf("no IP addresses resolved for %q", host)
	}

	// 2. Validate all resolved IPs against private deny-list
	var targetIP net.IP
	for _, ip := range ips {
		if sd.isIPPermitted(ip) {
			targetIP = ip
			break
		}
	}

	if targetIP == nil {
		return nil, fmt.Errorf("%w: resolved addresses %v for host %q are prohibited", ErrSSRFDestinationBlocked, ips, host)
	}

	// 3. Dial directly to the verified IP (neutralizes DNS rebinding)
	dialer := &net.Dialer{Timeout: sd.DialTimeout}
	targetAddr := net.JoinHostPort(targetIP.String(), port)
	return dialer.DialContext(ctx, network, targetAddr)
}

func (sd *SafeDialer) isIPPermitted(ip net.IP) bool {
	// Check administrator explicitly allowed CIDRs first
	for _, allowed := range sd.AllowedCIDRs {
		if allowed.Contains(ip) {
			return true
		}
	}

	// If local egress is permitted (development only), allow loopbacks and private
	if sd.AllowLocalEgress {
		return true
	}

	// Otherwise, reject private/cloud-metadata/loopback
	return !IsPrivateIP(ip)
}

// NewSafeHTTPClient returns an http.Client configured with SSRF protection,
// TLS SNI preservation, and redirect security.
func NewSafeHTTPClient(allowLocalEgress bool, allowedCIDRs []string, timeout time.Duration) *http.Client {
	dialer := NewSafeDialer(allowLocalEgress, allowedCIDRs)

	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ResponseHeaderTimeout: timeout,
		IdleConnTimeout:       30 * time.Second,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   10,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		// Secure redirect policy: re-verify target before following redirects
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("stopped after 3 redirects")
			}
			// Verify redirect host is permitted
			targetHost := req.URL.Hostname()
			ips, err := net.LookupIP(targetHost)
			if err != nil {
				return err
			}
			for _, ip := range ips {
				if !dialer.isIPPermitted(ip) {
					return ErrSSRFDestinationBlocked
				}
			}
			return nil
		},
	}

	return client
}

// ValidateTargetURL parses and inspects a target URL before storing it in registries.
func ValidateTargetURL(targetURL string, allowLocal bool) error {
	u, err := url.Parse(targetURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported URL scheme %q: must be http or https", u.Scheme)
	}

	hostname := u.Hostname()
	if hostname == "" {
		return errors.New("empty hostname in URL")
	}

	// Reject obvious metadata hostnames immediately
	if hostname == "169.254.169.254" || hostname == "metadata.google.internal" || hostname == "instance-data" {
		return ErrSSRFDestinationBlocked
	}

	// If hostname is raw IP
	if ip := net.ParseIP(hostname); ip != nil {
		if !allowLocal && IsPrivateIP(ip) {
			return ErrSSRFDestinationBlocked
		}
	}

	return nil
}
