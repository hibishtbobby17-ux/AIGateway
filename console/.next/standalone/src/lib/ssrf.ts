import dns from 'dns';
import net from 'net';

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFError';
  }
}

// Convert IPv4 string to 32-bit unsigned integer
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// Check if IPv4 belongs to CIDR range
function inCIDR(ipInt: number, cidrBaseInt: number, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (cidrBaseInt & mask);
}

// Blocked metadata & link-local ranges (NEVER allowed, even locally)
const METADATA_RANGES = [
  { base: '169.254.0.0', mask: 16 }, // Link-local & Cloud Metadata (169.254.169.254)
  { base: '100.64.0.0', mask: 10 },  // Carrier-grade NAT
  { base: '0.0.0.0', mask: 8 },      // Broadcast / unspecified
  { base: '224.0.0.0', mask: 4 },    // Multicast
  { base: '240.0.0.0', mask: 4 },    // Reserved
].map(r => ({ baseInt: ipv4ToInt(r.base), mask: r.mask }));

// Private IPv4 ranges
const PRIVATE_RANGES = [
  { base: '127.0.0.0', mask: 8 },     // Loopback
  { base: '10.0.0.0', mask: 8 },      // Private 10.x
  { base: '172.16.0.0', mask: 12 },   // Private 172.16.x
  { base: '192.168.0.0', mask: 16 },  // Private 192.168.x
].map(r => ({ baseInt: ipv4ToInt(r.base), mask: r.mask }));

export async function validateSSRF(targetUrl: string, allowLocalEgress?: boolean): Promise<boolean> {
  const allowLocal = allowLocalEgress ?? (process.env.ALLOW_LOCAL_EGRESS === 'true' || process.env.NODE_ENV === 'test');

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new SSRFError('Invalid destination URL');
  }

  // Enforce HTTP / HTTPS schemes only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SSRFError(`Forbidden protocol: ${parsed.protocol}. Only http: and https: are permitted.`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SSRFError('URL is missing a valid hostname');
  }

  // Block obvious metadata domains
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost.includes('169.254.169.254') ||
    lowerHost.includes('metadata.google.internal') ||
    lowerHost.includes('metadata.internal') ||
    lowerHost.includes('instance-data')
  ) {
    throw new SSRFError(`Security violation: Access to cloud metadata service (${hostname}) is blocked.`);
  }

  // Resolve DNS to IP
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      addresses = records.map(r => r.address);
    } catch (err: any) {
      throw new SSRFError(`DNS resolution failed for ${hostname}: ${err.message}`);
    }
  }

  for (const ip of addresses) {
    if (net.isIPv4(ip)) {
      const ipInt = ipv4ToInt(ip);

      // 1. Check against metadata ranges (never allowed)
      for (const range of METADATA_RANGES) {
        if (inCIDR(ipInt, range.baseInt, range.mask)) {
          throw new SSRFError(`Security violation: IP ${ip} is in restricted metadata or link-local range.`);
        }
      }

      // 2. Check against private ranges if local egress is disallowed
      if (!allowLocal) {
        for (const range of PRIVATE_RANGES) {
          if (inCIDR(ipInt, range.baseInt, range.mask)) {
            throw new SSRFError(`Security violation: IP ${ip} is in a private network range.`);
          }
        }
      }
    } else if (net.isIPv6(ip)) {
      // Check IPv6 loopback / unique local / link local
      const isV6Loopback = ip === '::1' || ip === '::';
      const isV6LinkLocal = ip.toLowerCase().startsWith('fe80:');
      const isV6UniqueLocal = ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd');

      if (isV6LinkLocal) {
        throw new SSRFError(`Security violation: IPv6 ${ip} is link-local.`);
      }

      if (!allowLocal && (isV6Loopback || isV6UniqueLocal)) {
        throw new SSRFError(`Security violation: IPv6 ${ip} is private/loopback.`);
      }
    }
  }

  return true;
}
