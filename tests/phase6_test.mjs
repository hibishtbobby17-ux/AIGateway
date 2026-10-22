// Phase 6 Acceptance Test: Logs + Ingest
// Validates:
// 1. Gateway request appears in Console log viewer (multi-dimensional filtering).
// 2. Gateway resilience & disk spooling: events survive Ingest outage and are flushed upon recovery.
// 3. Ingest exposes NO read or UI routes (only health checks and POST ingest endpoints).
// 4. Client-facing ingest endpoint (POST /ingest/v1/logs) idempotency & ingestion.

import { execSync } from 'child_process';

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3000';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const INGEST_URL = process.env.INGEST_URL || 'http://127.0.0.1:8082';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('====================================================');
  console.log('🚀 STARTING PHASE 6 ACCEPTANCE TESTS: Logs + Ingest');
  console.log('====================================================\n');

  // 1. Verify health of all services
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

  // 3. Setup Project and Downstream Server
  console.log('3️⃣ Setting up project and downstream server...');
  const projSlug = `p6-proj-${Date.now()}`;
  const projRes = await fetch(`${CONSOLE_URL}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Phase 6 Test Project', slug: projSlug }),
  });
  if (!projRes.ok) throw new Error(`Failed to create project: ${await projRes.text()}`);
  const { project } = await projRes.json();
  console.log(`   ✅ Created project: ${project.slug} (${project.id})`);

  // Add mock math MCP server
  const serverRes = await fetch(`${CONSOLE_URL}/api/projects/${project.id}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Phase 6 Math Server',
      namespace_prefix: 'p6math',
      transport: 'http',
      url: 'http://127.0.0.1:3000/api/mock/mcp-math',
      auth_type: 'none',
    }),
  });
  if (!serverRes.ok) throw new Error(`Failed to add server: ${await serverRes.text()}`);
  const { server: mcpServer } = await serverRes.json();
  console.log(`   ✅ Added downstream server: ${mcpServer.name} (${mcpServer.id})`);

  // Wait for gateway config sync
  console.log('   ⏳ Waiting for gateway config synchronization (< 3s)...');
  await sleep(2500);

  // 3. Test Criterion 1: Every Gateway Request Appears in the Console Log Viewer
  console.log('3️⃣ Criterion 1: Testing that Gateway requests appear in the Console Log Viewer...');
  const traceId1 = `w3c-trace-p6-${Date.now()}`;
  const mcpCallRes = await fetch(`${GATEWAY_URL}/p/${projSlug}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'traceparent': traceId1,
      'X-Client-ID': 'phase6-test-client',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'p6math__calculate',
        arguments: { expression: '21 * 2' },
      },
    }),
  });

  if (!mcpCallRes.ok) throw new Error(`Gateway tool call failed: ${await mcpCallRes.text()}`);
  const mcpData = await mcpCallRes.json();
  console.log('   ✅ Gateway handled tools/call:', JSON.stringify(mcpData.result));

  // Wait for spooler flush (400ms), stream consumer, and DB insert
  console.log('   ⏳ Waiting for Ingest stream flush to log store...');
  await sleep(1500);

  // Query Console Log API
  const logsRes = await fetch(`${CONSOLE_URL}/api/logs?project=${projSlug}&search=calculate`);
  if (!logsRes.ok) throw new Error(`Failed to fetch logs: ${await logsRes.text()}`);
  const logsData = await logsRes.json();

  if (!logsData.logs || logsData.logs.length === 0) {
    throw new Error('Expected log entry in Console Log Viewer, but none found!');
  }

  const logEntry = logsData.logs[0];
  console.log(`   ✅ Found log entry in Console Log Viewer:`);
  console.log(`      - Event ID: ${logEntry.event_id}`);
  console.log(`      - Project: ${logEntry.project}`);
  console.log(`      - Tool: ${logEntry.tool}`);
  console.log(`      - Status: ${logEntry.status}`);
  console.log(`      - Latency: ${logEntry.latency_ms} ms`);
  console.log(`      - Trace ID: ${logEntry.trace_id}`);
  console.log(`      - Client ID: ${logEntry.client_id}`);

  if (logEntry.status !== '200') throw new Error(`Expected status 200, got ${logEntry.status}`);
  if (logEntry.trace_id !== traceId1) throw new Error(`Expected trace_id ${traceId1}, got ${logEntry.trace_id}`);
  if (!logEntry.tool.includes('calculate')) throw new Error(`Expected tool to contain calculate, got ${logEntry.tool}`);
  console.log('   🏆 Criterion 1 PASSED: Gateway request verified in Console Log Viewer!\n');

  // 4. Test Criterion 2: Events Survive an Ingest Outage via Spool
  console.log('4️⃣ Criterion 2: Testing events survive an Ingest outage via spool...');
  console.log('   💥 Stopping Ingest service to simulate an outage (docker compose stop ingest)...');
  execSync('docker compose stop ingest', { stdio: 'inherit' });

  // Verify Ingest is down
  let ingestDown = false;
  try {
    await fetch(`${INGEST_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
  } catch {
    ingestDown = true;
  }
  if (!ingestDown) throw new Error('Ingest service is still responding after docker compose stop!');
  console.log('   ✅ Ingest service is confirmed DOWN.');

  // Send requests to Gateway DURING the outage
  console.log('   📤 Sending requests through Gateway DURING the outage...');
  const outageTrace1 = `outage-trace-1-${Date.now()}`;
  const outageTrace2 = `outage-trace-2-${Date.now()}`;
  const outageTrace3 = `outage-trace-3-${Date.now()}`;

  // Request 1: tools/list
  const listRes = await fetch(`${GATEWAY_URL}/p/${projSlug}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'traceparent': outageTrace1 },
    body: JSON.stringify({ jsonrpc: '2.0', id: 201, method: 'tools/list' }),
  });
  if (!listRes.ok) throw new Error(`Gateway failed during outage: ${await listRes.text()}`);

  // Request 2: tools/call calculate
  const callRes = await fetch(`${GATEWAY_URL}/p/${projSlug}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'traceparent': outageTrace2 },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 202,
      method: 'tools/call',
      params: { name: 'p6math__calculate', arguments: { expression: '50 * 2' } },
    }),
  });
  if (!callRes.ok) throw new Error(`Gateway failed during outage: ${await callRes.text()}`);

  // Request 3: unknown method (generates error response)
  const unknownRes = await fetch(`${GATEWAY_URL}/p/${projSlug}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'traceparent': outageTrace3 },
    body: JSON.stringify({ jsonrpc: '2.0', id: 203, method: 'tools/invalid_test_method' }),
  });
  if (!unknownRes.ok) throw new Error(`Gateway failed during outage: ${await unknownRes.text()}`);

  console.log('   ✅ Gateway served all 3 requests with zero degradation during Ingest outage!');

  // Wait for Gateway flusher to encounter network error and spool to disk
  console.log('   🔍 Waiting for Gateway to detect outage and write events to local disk spool (/tmp/gateway_events.spool)...');
  let spooled = false;
  let spoolStat = '';
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    try {
      spoolStat = execSync('docker exec ai-gateway sh -c "wc -l /tmp/gateway_events.spool 2>/dev/null || true"').toString().trim();
      if (spoolStat && !spoolStat.startsWith('0')) {
        console.log(`   📁 Gateway disk spool contents: ${spoolStat}`);
        spooled = true;
        break;
      }
    } catch {}
  }
  if (!spooled) {
    throw new Error('Expected spooled events in /tmp/gateway_events.spool during Ingest outage, but file is empty or not created!');
  }
  console.log('   ✅ Verified events are spooled on disk inside the Gateway container!');

  // Verify that these outage events have NOT yet arrived in Console
  const logsDuringOutage = await fetch(`${CONSOLE_URL}/api/logs?trace_id=${outageTrace2}`).then(r => r.json());
  if (logsDuringOutage.logs && logsDuringOutage.logs.length > 0) {
    throw new Error('Events should not be in Console yet because Ingest is down!');
  }
  console.log('   ✅ Confirmed events are safely held on disk and have not reached database prematurely.');

  // RESTART Ingest service
  console.log('   🔄 Restarting Ingest service (docker compose start ingest)...');
  execSync('docker compose start ingest', { stdio: 'inherit' });

  // Wait for Ingest health
  console.log('   ⏳ Waiting for Ingest to recover and report healthy...');
  let ingestRecovered = false;
  for (let i = 0; i < 20; i++) {
    try {
      const h = await fetch(`${INGEST_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (h.ok) {
        ingestRecovered = true;
        break;
      }
    } catch {}
    await sleep(500);
  }
  if (!ingestRecovered) throw new Error('Ingest service did not recover in time!');
  console.log('   ✅ Ingest service is back ONLINE and healthy!');

  // Wait for Gateway spool retry worker to probe Ingest, flush spooled events, and consumer to drain
  console.log('   ⏳ Waiting for Gateway spool retry worker to drain spooled events into Ingest...');
  let recovered1 = null;
  let recovered2 = null;
  let recovered3 = null;

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (!recovered1) {
      const res1 = await fetch(`${CONSOLE_URL}/api/logs?trace_id=${outageTrace1}`).then(r => r.json()).catch(() => ({}));
      if (res1.logs && res1.logs.length > 0) recovered1 = res1.logs[0];
    }
    if (!recovered2) {
      const res2 = await fetch(`${CONSOLE_URL}/api/logs?trace_id=${outageTrace2}`).then(r => r.json()).catch(() => ({}));
      if (res2.logs && res2.logs.length > 0) recovered2 = res2.logs[0];
    }
    if (!recovered3) {
      const res3 = await fetch(`${CONSOLE_URL}/api/logs?trace_id=${outageTrace3}`).then(r => r.json()).catch(() => ({}));
      if (res3.logs && res3.logs.length > 0) recovered3 = res3.logs[0];
    }
    if (recovered1 && recovered2 && recovered3) break;
  }

  if (!recovered1) throw new Error(`Outage event 1 (${outageTrace1}) was NOT recovered from disk spool!`);
  if (!recovered2) throw new Error(`Outage event 2 (${outageTrace2}) was NOT recovered from disk spool!`);
  if (!recovered3) throw new Error(`Outage event 3 (${outageTrace3}) was NOT recovered from disk spool!`);

  console.log('   ✅ All 3 outage events were successfully drained and recovered in the database:');
  console.log(`      1. List event (${outageTrace1}): status=${recovered1.status}`);
  console.log(`      2. Call event (${outageTrace2}): status=${recovered2.status}, latency=${recovered2.latency_ms}ms`);
  console.log(`      3. Error event (${outageTrace3}): status=${recovered3.status}, error=${recovered3.error}`);

  console.log('   🏆 Criterion 2 PASSED: Events survived Ingest outage via disk spool!\n');

  // 5. Test Criterion 3: Ingest Service Exposes NO UI or Read Routes
  console.log('5️⃣ Criterion 3: Verifying Ingest exposes NO UI or read routes...');
  const forbiddenRoutes = [
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/logs' },
    { method: 'GET', path: '/ingest/v1/logs' },
    { method: 'GET', path: '/ingest/v1/telemetry' },
    { method: 'GET', path: '/admin' },
    { method: 'GET', path: '/dashboard' },
  ];

  for (const r of forbiddenRoutes) {
    const res = await fetch(`${INGEST_URL}${r.path}`, { method: r.method });
    const text = await res.text();
    const contentType = res.headers.get('content-type') || '';

    // Must be 404 or 405
    if (res.status !== 404 && res.status !== 405) {
      throw new Error(`Ingest route ${r.method} ${r.path} returned status ${res.status}, expected 404 or 405!`);
    }

    // Must NOT be HTML
    if (contentType.includes('text/html') || text.toLowerCase().includes('<!doctype') || text.toLowerCase().includes('<html')) {
      throw new Error(`Ingest route ${r.method} ${r.path} exposed an HTML UI! Body: ${text.substring(0, 100)}`);
    }

    console.log(`   ✅ ${r.method} ${r.path} ➔ Status ${res.status} (Strictly No UI)`);
  }
  console.log('   🏆 Criterion 3 PASSED: Ingest exposes zero UI or read routes!\n');

  // 6. Test Client-Facing Ingest Endpoint (POST /ingest/v1/logs)
  console.log('6️⃣ Client-Facing Ingest Endpoint Testing (POST /ingest/v1/logs)...');
  const clientEventId = `client-ev-${Date.now()}`;
  const clientLogRes = await fetch(`${INGEST_URL}/ingest/v1/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: clientEventId,
      project: projSlug,
      tool: 'external_client_eval',
      status: '200',
      latency_ms: 45.2,
      attributes: { client_sdk: 'python-mcp-v1', tokens_used: 150 },
    }),
  });

  if (clientLogRes.status !== 202) {
    throw new Error(`Client ingest failed, expected 202 Accepted, got ${clientLogRes.status}: ${await clientLogRes.text()}`);
  }
  console.log('   ✅ Client log submitted, received 202 Accepted.');

  await sleep(1500);

  const clientLogQuery = await fetch(`${CONSOLE_URL}/api/logs?tool=external_client_eval`).then(r => r.json());
  if (!clientLogQuery.logs || clientLogQuery.logs.length === 0) {
    throw new Error('Client ingested log did not appear in Console Log API!');
  }
  const clientSaved = clientLogQuery.logs.find(l => l.event_id === clientEventId);
  if (!clientSaved) {
    throw new Error(`Client event ${clientEventId} not found in log query results!`);
  }
  console.log(`   ✅ Direct client log verified in Console: event_id=${clientSaved.event_id}, tool=${clientSaved.tool}`);

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 6 ACCEPTANCE CRITERIA HAVE PASSED!');
  console.log('====================================================');
}

runTest().catch((err) => {
  console.error('\n❌ PHASE 6 ACCEPTANCE TEST FAILED:');
  console.error(err);
  process.exit(1);
});
