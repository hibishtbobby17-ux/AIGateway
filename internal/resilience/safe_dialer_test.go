package resilience

import (
	"context"
	"errors"
	"net"
	"testing"
)

func TestIsPrivateIP(t *testing.T) {
	testCases := []struct {
		ip       string
		expected bool
	}{
		{"127.0.0.1", true},
		{"10.0.0.1", true},
		{"172.16.0.5", true},
		{"192.168.1.1", true},
		{"169.254.169.254", true}, // AWS/GCP metadata
		{"0.0.0.0", true},
		{"::1", true},
		{"8.8.8.8", false},       // Google DNS (public)
		{"1.1.1.1", false},       // Cloudflare DNS (public)
		{"93.184.216.34", false}, // example.com (public)
	}

	for _, tc := range testCases {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("failed parsing test IP %s", tc.ip)
		}
		got := IsPrivateIP(ip)
		if got != tc.expected {
			t.Errorf("IsPrivateIP(%s) = %v; expected %v", tc.ip, got, tc.expected)
		}
	}
}

func TestSafeDialerBlocksMetadataAndLoopback(t *testing.T) {
	dialer := NewSafeDialer(false, nil)

	// Attempt dialing cloud metadata IP
	_, err := dialer.DialContext(context.Background(), "tcp", "169.254.169.254:80")
	if err == nil || !errors.Is(err, ErrSSRFDestinationBlocked) {
		t.Fatalf("expected ErrSSRFDestinationBlocked for metadata dial, got: %v", err)
	}

	// Attempt dialing loopback
	_, err = dialer.DialContext(context.Background(), "tcp", "127.0.0.1:8080")
	if err == nil || !errors.Is(err, ErrSSRFDestinationBlocked) {
		t.Fatalf("expected ErrSSRFDestinationBlocked for loopback dial, got: %v", err)
	}
}

func TestValidateTargetURL(t *testing.T) {
	// Blocked URLs
	blocked := []string{
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:8080/mcp",
		"http://10.0.0.1:9090",
		"http://metadata.google.internal/computeMetadata/v1/",
		"ftp://example.com/test", // invalid scheme
	}

	for _, u := range blocked {
		err := ValidateTargetURL(u, false)
		if err == nil {
			t.Errorf("expected URL %q to be blocked, but validation passed", u)
		}
	}

	// Permitted public URLs
	valid := []string{
		"https://api.github.com/mcp",
		"https://tools.acme.com:443/mcp/sse",
	}

	for _, u := range valid {
		err := ValidateTargetURL(u, false)
		if err != nil {
			t.Errorf("expected URL %q to be valid, got: %v", u, err)
		}
	}
}
