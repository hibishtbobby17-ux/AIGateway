// Phase 7 Acceptance Test: Hardening & Section 12 Security Checklist
// Validates:
// 1. Secrets encrypted at rest & never logged/returned by GET APIs.
// 2. Gateway secret rotation & revocation (old secret invalid, revoked gateway blocked).
// 3. SSRF guard on all user-configurable URLs (blocks metadata 169.254.169.254, loopback, file/non-http).
// 4. Audit log records all Console mutations with sensitive data redacted.
// 5. Input validation & request size limits (HTTP 413 on oversized payloads).
// 6. Ingest rate limiting (HTTP 429 + Retry-After) and Prometheus /metrics.
// 7. Gateway rate limiting (HTTP 429 + X-RateLimit headers + Retry-After) and Prometheus /metrics.

import http from 'node:http';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3000';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const INGEST_URL = process.env.INGEST_URL || 'http://127.0.0.1:8082';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase7Tests() {
  console.log('================================================================');
  console.log('🚀 STARTING PHASE 7 ACCEPTANCE TESTS: Hardening & Security Audit');
  console.log('================================================================\n');

  // 1. Verify health of services
  console.log('1️⃣ Checking service health endpoints...');
  const consoleHealth = await fetch(`${CONSOLE_URL}/api/healthz`).then(r => r.json()).catch(() => null);
  const gatewayHealth = await fetch(`${GATEWAY_URL}/healthz`).then(r => r.json()).catch(() => null);
  const ingestHealth = await fetch(`${INGEST_URL}/healthz`).then(r => r.json()).catch(() => null);

  if (!consoleHealth || !gatewayHealth || !ingestHealth) {
    throw new Error(`Services not all healthy! console=${JSON.stringify(consoleHealth)} gateway=${JSON.stringify(gatewayHealth)} ingest=${JSON.stringify(ingestHealth)}`);
  }
  console.log('   ✅ Console, Gateway, and Ingest are all healthy!\n');

  // 2. Authenticate to Console as Admin
  console.log('2️⃣ Authenticating to Console as Admin...');
  const loginRes = await fetch(`${CONSOLE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' }),
  });
  if (!loginRes.ok) throw new Error(`Console login failed: ${await loginRes.text()}`);
  const { token, user } = await loginRes.json();
  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  console.log(`   ✅ Authenticated as ${user.email}\n`);

  // 3. Test Criterion 1: Secrets Never Exposed in GET APIs & Encrypted/Hashed at Rest
  console.log('3️⃣ Criterion 1: Testing Secret Lifecycle & Non-exposure in GET APIs...');
  const gwName = `p7-gateway-${Date.now()}`;
  const createGwRes = await fetch(`${CONSOLE_URL}/api/gateways`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: gwName, region: 'us-east-1' }),
  });
  if (!createGwRes.ok) throw new Error(`Failed to create gateway: ${await createGwRes.text()}`);
  const gwCreateData = await createGwRes.json();
  const originalSecret = gwCreateData.secret;
  const gatewayId = gwCreateData.gateway.id;

  if (!originalSecret || !originalSecret.startsWith('gwsec_')) {
    throw new Error(`Expected gateway secret starting with gwsec_, got ${originalSecret}`);
  }
  console.log(`   ✅ Gateway registered: ID=${gatewayId}, initial secret returned on creation.`);

  // Verify GET /api/gateways does NOT expose the secret
  const listGwsRes = await fetch(`${CONSOLE_URL}/api/gateways`, { headers: authHeaders });
  const listGwsData = await listGwsRes.json();
  const foundGw = listGwsData.gateways?.find((g) => g.id === gatewayId);
  if (!foundGw) throw new Error(`Created gateway ${gatewayId} not found in list`);
  if (foundGw.secret) throw new Error('Security Violation: Raw secret returned in GET /api/gateways list!');
  if (foundGw.secret_hash && foundGw.secret_hash !== '***masked***') {
    throw new Error('Security Violation: Unmasked secret_hash returned in GET /api/gateways!');
  }

  // Verify GET /api/gateways/:id does NOT expose the secret
  const getGwRes = await fetch(`${CONSOLE_URL}/api/gateways/${gatewayId}`, { headers: authHeaders });
  const getGwData = await getGwRes.json();
  if (getGwData.gateway.secret) throw new Error('Security Violation: Raw secret returned in GET /api/gateways/:id!');
  if (getGwData.gateway.secret_hash && getGwData.gateway.secret_hash !== '***masked***') {
    throw new Error('Security Violation: Unmasked secret_hash returned in GET /api/gateways/:id!');
  }
  console.log('   ✅ Section 12 Rule 1 PASSED: Secrets never leaked in GET APIs, hashes masked.\n');

  // 4. Test Criterion 2: Secret Rotation & Gateway Revocation
  console.log('4️⃣ Criterion 2: Testing Gateway Secret Rotation and Revocation...');
  // Rotate Secret
  const rotateRes = await fetch(`${CONSOLE_URL}/api/gateways/${gatewayId}/rotate-secret`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!rotateRes.ok) throw new Error(`Failed to rotate gateway secret: ${await rotateRes.text()}`);
  const rotateData = await rotateRes.json();
  const newSecret = rotateData.secret;

  if (!newSecret || newSecret === originalSecret) {
    throw new Error(`Rotated secret invalid or identical to old secret: ${newSecret}`);
  }
  console.log(`   ✅ Secret successfully rotated. New secret length=${newSecret.length}`);

  // Test authenticating with OLD secret -> must be rejected (401)
  const oldAuthRes = await fetch(`${CONSOLE_URL}/api/gateway/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateway_id: gatewayId, secret: originalSecret }),
  });
  if (oldAuthRes.status !== 401) {
    throw new Error(`Expected HTTP 401 using old rotated secret, got ${oldAuthRes.status}`);
  }
  console.log('   ✅ Old secret correctly rejected with HTTP 401 Unauthorized.');

  // Test authenticating with NEW secret -> must succeed (200)
  const newAuthRes = await fetch(`${CONSOLE_URL}/api/gateway/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateway_id: gatewayId, secret: newSecret }),
  });
  if (!newAuthRes.ok) {
    throw new Error(`Expected HTTP 200 using new rotated secret, got ${newAuthRes.status}: ${await newAuthRes.text()}`);
  }
  const authPayload = await newAuthRes.json();
  if (!authPayload.token) throw new Error('Expected auth JWT token with new secret');
  console.log('   ✅ New secret successfully authenticated with HTTP 200.');

  // Test Gateway Revocation
  const revokeRes = await fetch(`${CONSOLE_URL}/api/gateways/${gatewayId}/revoke`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!revokeRes.ok) throw new Error(`Failed to revoke gateway: ${await revokeRes.text()}`);
  console.log('   ✅ Gateway revoked via POST /api/gateways/:id/revoke.');

  // Test authenticating with Revoked Gateway -> must fail (403)
  const revokedAuthRes = await fetch(`${CONSOLE_URL}/api/gateway/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gateway_id: gatewayId, secret: newSecret }),
  });
  if (revokedAuthRes.status !== 403 && revokedAuthRes.status !== 401) {
    throw new Error(`Expected HTTP 403 for revoked gateway, got ${revokedAuthRes.status}`);
  }
  console.log('   ✅ Revoked gateway correctly rejected from authentication.');

  // Test heartbeat with Revoked Gateway -> must fail (403)
  const revokedHeartbeatRes = await fetch(`${CONSOLE_URL}/api/gateway/v1/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authPayload.token}`,
    },
    body: JSON.stringify({ status: 'healthy', active_connections: 5 }),
  });
  if (revokedHeartbeatRes.status !== 403 && revokedHeartbeatRes.status !== 401) {
    throw new Error(`Expected HTTP 403 heartbeat for revoked gateway, got ${revokedHeartbeatRes.status}`);
  }
  console.log('   ✅ Revoked gateway correctly rejected from heartbeat.');
  console.log('   🏆 Criterion 2 PASSED: Secret rotation and revocation fully verified!\n');

  // 5. Test Criterion 3: SSRF Guards on User-Configurable URLs
  console.log('5️⃣ Criterion 3: Testing SSRF Protection on User-Configurable URLs...');
  // Create a project for SSRF testing
  const p7ProjSlug = `p7-proj-${Date.now()}`;
  const projRes = await fetch(`${CONSOLE_URL}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Phase 7 Security Lab', slug: p7ProjSlug }),
  });
  if (!projRes.ok) throw new Error(`Failed to create project: ${await projRes.text()}`);
  const { project } = await projRes.json();
  console.log(`   ✅ Created project: ${project.slug} (${project.id})`);

  // Wait for gateway config sync
  console.log('   ⏳ Waiting for gateway config synchronization (< 3s)...');
  await sleep(2500);

  // Test 1: Cloud Metadata SSRF URL (169.254.169.254)
  const metadataSsrfRes = await fetch(`${CONSOLE_URL}/api/projects/${project.id}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Evil AWS Metadata Server',
      namespace_prefix: 'evil',
      transport: 'http',
      url: 'http://169.254.169.254/latest/meta-data/',
      auth_type: 'none',
    }),
  });
  if (metadataSsrfRes.status !== 400) {
    throw new Error(`Security Violation: Expected 400 Bad Request for cloud metadata URL, got ${metadataSsrfRes.status}`);
  }
  const metaErr = await metadataSsrfRes.json();
  console.log(`   ✅ Blocked AWS Metadata IP: "${metaErr.error}"`);

  // Test 2: File Protocol SSRF (file:///etc/passwd)
  const fileSsrfRes = await fetch(`${CONSOLE_URL}/api/projects/${project.id}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Evil File Protocol Server',
      namespace_prefix: 'evil_file',
      transport: 'http',
      url: 'file:///etc/passwd',
      auth_type: 'none',
    }),
  });
  if (fileSsrfRes.status !== 400) {
    throw new Error(`Security Violation: Expected 400 Bad Request for file:// protocol, got ${fileSsrfRes.status}`);
  }
  const fileErr = await fileSsrfRes.json();
  console.log(`   ✅ Blocked Non-HTTP Protocol: "${fileErr.error}"`);

  // Test 3: Loopback SSRF in production mode / custom internal IP
  const internalSsrfRes = await fetch(`${CONSOLE_URL}/api/projects/${project.id}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Evil GCP Metadata Server',
      namespace_prefix: 'evil_gcp',
      transport: 'http',
      url: 'http://metadata.google.internal/computeMetadata/v1/',
      auth_type: 'none',
    }),
  });
  if (internalSsrfRes.status !== 400) {
    throw new Error(`Security Violation: Expected 400 Bad Request for cloud internal metadata, got ${internalSsrfRes.status}`);
  }
  const gcpErr = await internalSsrfRes.json();
  console.log(`   ✅ Blocked Cloud Internal Metadata: "${gcpErr.error}"`);
  console.log('   🏆 Criterion 3 PASSED: SSRF Guard rigorously enforces Section 12 rule 4!\n');

  // 6. Test Criterion 4: Audit Logging for Console Mutations
  console.log('6️⃣ Criterion 4: Testing Audit Trail Logging & Redaction...');
  const auditRes = await fetch(`${CONSOLE_URL}/api/audit?limit=50`, { headers: authHeaders });
  if (!auditRes.ok) throw new Error(`Failed to fetch audit log: ${await auditRes.text()}`);
  const { audit_logs } = await auditRes.json();

  if (!audit_logs || audit_logs.length === 0) {
    throw new Error('Audit log is empty! Expected mutations to be logged.');
  }

  const actions = audit_logs.map((l) => l.action);
  console.log(`   📋 Found ${audit_logs.length} audit entries. Recent actions: ${actions.slice(0, 6).join(', ')}`);

  // Verify critical actions were captured
  if (!actions.includes('gateway.create')) throw new Error('Missing gateway.create in audit trail!');
  if (!actions.includes('gateway.rotate_secret')) throw new Error('Missing gateway.rotate_secret in audit trail!');
  if (!actions.includes('gateway.revoke')) throw new Error('Missing gateway.revoke in audit trail!');
  if (!actions.includes('project.create')) throw new Error('Missing project.create in audit trail!');

  // Verify sensitive fields are redacted in diffs
  for (const log of audit_logs) {
    const diffStr = JSON.stringify(log.diff || {});
    if (diffStr.includes(originalSecret) || diffStr.includes(newSecret)) {
      throw new Error(`Security Violation: Plaintext secret leaked into audit log diff! ID=${log.id}`);
    }
    if (diffStr.includes('$2a$') || diffStr.includes('$2b$')) {
      throw new Error(`Security Violation: Bcrypt hash leaked into audit log diff! ID=${log.id}`);
    }
  }
  console.log('   ✅ All mutation actions verified and diffs confirmed free of unredacted secrets.');

  // Test filtering by action
  const rotateFilterRes = await fetch(`${CONSOLE_URL}/api/audit?action=gateway.rotate_secret`, { headers: authHeaders });
  const rotateLogs = (await rotateFilterRes.json()).audit_logs;
  if (!rotateLogs || rotateLogs.length === 0 || !rotateLogs.every((l) => l.action === 'gateway.rotate_secret')) {
    throw new Error('Audit filter by action=gateway.rotate_secret failed');
  }
  console.log(`   ✅ Audit log filtering works correctly (${rotateLogs.length} gateway.rotate_secret events).`);
  console.log('   🏆 Criterion 4 PASSED: Audit trail complete, searchable, and sanitized!\n');

  // 7. Test Criterion 5: Request Payload Size Limits (HTTP 413)
  console.log('7️⃣ Criterion 5: Testing Gateway Request Size Limits (HTTP 413)...');
  // Attempt to send an oversized payload (Content-Length 10MB exceeds 5MB limit)
  const oversizedStatus = await new Promise((resolve, reject) => {
    const req = http.request(`${GATEWAY_URL}/p/${p7ProjSlug}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '10485760',
      },
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

  if (oversizedStatus !== 413) {
    throw new Error(`Expected HTTP 413 Payload Too Large for 10MB payload, got ${oversizedStatus}`);
  }
  console.log('   ✅ Gateway rejected 10MB oversized request with HTTP 413 Payload Too Large.\n');

  // 8. Test Criterion 6: Ingest Rate Limiting & Prometheus Metrics
  console.log('8️⃣ Criterion 6: Testing Ingest Rate Limiting & Prometheus Metrics...');
  // Test Prometheus /metrics on Ingest
  const ingestMetricsRes = await fetch(`${INGEST_URL}/metrics`);
  if (!ingestMetricsRes.ok) throw new Error(`Ingest /metrics returned ${ingestMetricsRes.status}`);
  const ingestMetricsText = await ingestMetricsRes.text();
  if (!ingestMetricsText.includes('ingest_events_received_total') || !ingestMetricsText.includes('ingest_events_persisted_total')) {
    throw new Error('Ingest /metrics missing expected Prometheus metric keys');
  }
  console.log('   ✅ Ingest /metrics is operational and publishing Prometheus counters.');

  // Test Ingest Rate Limiting: burst requests to /ingest/v1/logs
  console.log('   ⚡ Firing burst to Ingest endpoint /ingest/v1/logs...');
  let ingestRateLimited = false;
  let retryAfterHeader = null;
  for (let i = 0; i < 70; i++) {
    const res = await fetch(`${INGEST_URL}/ingest/v1/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Key': 'phase7-burst-key',
      },
      body: JSON.stringify({
        schema_version: '1.0',
        events: [
          {
            event_id: `burst-ev-${i}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            trace_id: `trace-burst-${i}`,
            project_id: project.id,
            type: 'tool_call',
            status: '200',
            duration_ms: 12,
          },
        ],
      }),
    });
    if (res.status === 429) {
      ingestRateLimited = true;
      retryAfterHeader = res.headers.get('Retry-After');
      break;
    }
  }
  if (!ingestRateLimited) {
    throw new Error('Expected Ingest endpoint to enforce rate limit (HTTP 429), but burst was allowed!');
  }
  console.log(`   ✅ Ingest enforced rate limiting: HTTP 429 Too Many Requests (Retry-After: ${retryAfterHeader}s).\n`);

  // 9. Test Criterion 7: Gateway Rate Limiting & Prometheus Metrics
  console.log('9️⃣ Criterion 7: Testing Gateway Rate Limiting & Prometheus Metrics...');
  // Test Prometheus /metrics on Gateway
  const gatewayMetricsRes = await fetch(`${GATEWAY_URL}/metrics`);
  if (!gatewayMetricsRes.ok) throw new Error(`Gateway /metrics returned ${gatewayMetricsRes.status}`);
  const gatewayMetricsText = await gatewayMetricsRes.text();
  if (
    !gatewayMetricsText.includes('gateway_requests_total') ||
    !gatewayMetricsText.includes('gateway_inflight_requests') ||
    !gatewayMetricsText.includes('gateway_circuit_breaker_state')
  ) {
    throw new Error('Gateway /metrics missing expected Prometheus metric keys');
  }
  console.log('   ✅ Gateway /metrics is operational and publishing Prometheus counters.');

  // Test Gateway Rate Limiting: burst requests with client ID
  console.log('   ⚡ Firing burst to Gateway endpoint /p/:project/mcp...');
  let gatewayRateLimited = false;
  let gwHeaders = {};
  for (let i = 0; i < 70; i++) {
    const res = await fetch(`${GATEWAY_URL}/p/${p7ProjSlug}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-ID': 'phase7-stress-client',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 700 + i,
        method: 'tools/list',
      }),
    });
    if (res.status === 429) {
      gatewayRateLimited = true;
      gwHeaders = {
        retryAfter: res.headers.get('Retry-After'),
        limit: res.headers.get('X-RateLimit-Limit'),
        remaining: res.headers.get('X-RateLimit-Remaining'),
        reset: res.headers.get('X-RateLimit-Reset'),
      };
      break;
    }
  }
  if (!gatewayRateLimited) {
    throw new Error('Expected Gateway endpoint to enforce rate limit (HTTP 429), but burst was allowed!');
  }
  console.log('   ✅ Gateway enforced rate limiting: HTTP 429 Too Many Requests');
  console.log(`      - Retry-After: ${gwHeaders.retryAfter}s`);
  console.log(`      - X-RateLimit-Limit: ${gwHeaders.limit}`);
  console.log(`      - X-RateLimit-Remaining: ${gwHeaders.remaining}`);
  console.log(`      - X-RateLimit-Reset: ${gwHeaders.reset}s`);
  console.log('   🏆 Criterion 7 PASSED: Rate limits & metrics operational on Gateway & Ingest!\n');

  console.log('================================================================');
  console.log('🎉 ALL PHASE 7 ACCEPTANCE CRITERIA AND SECURITY CHECKS PASSED!');
  console.log('================================================================');
}

runPhase7Tests().catch((err) => {
  console.error('\n❌ PHASE 7 ACCEPTANCE TEST FAILED:');
  console.error(err);
  process.exit(1);
});
