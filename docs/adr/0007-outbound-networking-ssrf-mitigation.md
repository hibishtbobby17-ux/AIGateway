# ADR-0007: Outbound Networking and SSRF Mitigation Strategy

## Status
Accepted

## Context
As an AI gateway, the platform makes outbound network requests to upstream MCP servers (SSE/HTTP) and target A2A agents. If an attacker or compromised tenant registers a malicious URL (e.g., `http://169.254.169.254/latest/meta-data/` or internal Kubernetes cluster IPs `http://10.96.0.1`), the gateway could be exploited as an SSRF (Server-Side Request Forgery) proxy into the internal network, compromising cloud infrastructure credentials or internal databases.

## Decision
1. **Custom Hardened Egress Transport**:
   - Outbound HTTP clients must **not** use Go's default `http.DefaultTransport`.
   - Implement a custom `net.Dialer` wrapper (`internal/resilience/safe_dialer.go`) that controls address resolution and connection establishment.
2. **Pre-Dial IP Validation**:
   - Before establishing any TCP connection, the dialer resolves hostnames to IP addresses using a secure resolver.
   - Each resolved IP address is checked against a strict deny-list of non-routable, private, and sensitive CIDR blocks:
     - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 Private Networks)
     - `127.0.0.0/8` (IPv4 Loopback)
     - `169.254.0.0/16` (IPv4 Link-Local / AWS/GCP/Azure Cloud Metadata)
     - `::1/128` (IPv6 Loopback)
     - `fc00::/7` (IPv6 Unique Local Addresses)
     - `fe80::/10` (IPv6 Link-Local)
   - If any resolved IP falls within a forbidden range, the dial is aborted immediately with `ErrSSRFDestinationBlocked`.
3. **DNS Rebinding Prevention**:
   - To defeat DNS rebinding (where a hostname resolves to a public IP on initial validation, but to `127.0.0.1` on subsequent dial), the custom dialer connects **directly to the validated IP address** while retaining the original hostname in the TLS SNI (Server Name Indication) extension and `Host` HTTP header.
4. **Strict HTTP Redirect Handling**:
   - Disable automatic HTTP redirect following (`CheckRedirect: func(...) error { return http.ErrUseLastResponse }`) or re-evaluate the target redirect URL through the SSRF validator before following.
5. **Configurable Enterprise Overrides**:
   - For on-premise private enterprise deployments where upstream MCP servers legitimately reside on internal IP networks, administrators can explicitly configure a CIDR allow-list (`EGRESS_ALLOWED_CIDRS`) in the platform configuration.

## Consequences
### Positive
- Closes the single most severe attack vector inherent in proxy and gateway architectures.
- Neutralizes cloud metadata credential theft (`169.254.169.254`).
- Immune to DNS rebinding exploits.

### Negative
- Local development testing against `localhost` upstream servers requires an explicit development flag (`ALLOW_LOCAL_EGRESS=true`), which must be strictly forbidden in production configurations.
