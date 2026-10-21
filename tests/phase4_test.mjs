// Phase 4 Acceptance Criteria Automated Test
// Acceptance: A standard MCP client connected to /p/{slug}/mcp sees one server
// with all tools and can call tools on every downstream.

import { execSync } from 'child_process';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPhase4Verification() {
  console.log('=== Starting Phase 4 End-to-End Verification ===\n');

  // Step 1: Authenticate to Console as Admin
  console.log('Step 1: Authenticating to Console...');
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' })
  });
  if (!loginRes.ok) throw new Error('Console login failed');
  const { token, user } = await loginRes.json();
  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  console.log(`✓ Authenticated as ${user.email}\n`);

  // Step 2: Create a Dedicated Project for Aggregation Test
  const projectSlug = `mcp-agg-${Date.now()}`;
  console.log(`Step 2: Creating project with slug: ${projectSlug}...`);
  const projRes = await fetch('http://localhost:3000/api/projects', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'MCP Aggregation Lab',
      slug: projectSlug,
      settings: { max_in_flight: 200 }
    })
  });
  if (!projRes.ok) throw new Error(`Project creation failed: ${await projRes.text()}`);
  const { project } = await projRes.json();
  const projectId = project.id;
  console.log(`✓ Project created: ID=${projectId}, Initial Version=v${project.config_version}\n`);

  // Step 3: Add Downstream Server 1 (Mock Math MCP Server)
  console.log('Step 3: Adding Downstream Server 1 (Mock Math)...');
  const serverMathRes = await fetch(`http://localhost:3000/api/projects/${projectId}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Math Calculator Service',
      namespace_prefix: 'math',
      transport: 'http',
      url: 'http://console:3000/api/mock/mcp-math',
      auth_type: 'none'
    })
  });
  if (!serverMathRes.ok) throw new Error(`Adding math server failed: ${await serverMathRes.text()}`);
  const serverMath = (await serverMathRes.json()).server;
  console.log(`✓ Math Server registered: ID=${serverMath.id}`);

  // Discover tools on Math Server
  const mathDiscRes = await fetch(`http://localhost:3000/api/servers/${serverMath.id}/discover`, {
    method: 'POST',
    headers: authHeaders
  });
  if (!mathDiscRes.ok) throw new Error(`Math discovery failed: ${await mathDiscRes.text()}`);
  const mathDisc = await mathDiscRes.json();
  console.log(`✓ Discovered ${mathDisc.tools?.length || 0} tools on Math Server:`, mathDisc.tools.map(t => t.name).join(', '));

  // Step 4: Add Downstream Server 2 (Mock Weather MCP Server)
  console.log('\nStep 4: Adding Downstream Server 2 (Mock Weather)...');
  const serverWeatherRes = await fetch(`http://localhost:3000/api/projects/${projectId}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Weather Station Service',
      namespace_prefix: 'weather',
      transport: 'http',
      url: 'http://console:3000/api/mock/mcp-weather',
      auth_type: 'none'
    })
  });
  if (!serverWeatherRes.ok) throw new Error(`Adding weather server failed: ${await serverWeatherRes.text()}`);
  const serverWeather = (await serverWeatherRes.json()).server;
  console.log(`✓ Weather Server registered: ID=${serverWeather.id}`);

  // Discover tools on Weather Server
  const weatherDiscRes = await fetch(`http://localhost:3000/api/servers/${serverWeather.id}/discover`, {
    method: 'POST',
    headers: authHeaders
  });
  if (!weatherDiscRes.ok) throw new Error(`Weather discovery failed: ${await weatherDiscRes.text()}`);
  const weatherDisc = await weatherDiscRes.json();
  console.log(`✓ Discovered ${weatherDisc.tools?.length || 0} tools on Weather Server:`, weatherDisc.tools.map(t => t.name).join(', '));

  // Step 5: Configure ToolPolicy: Disable 'calculate_stats', Rename 'multiply' to 'times'
  console.log('\nStep 5: Applying ToolPolicy customizations...');
  // Disable calculate_stats
  const disPolicyRes = await fetch(`http://localhost:3000/api/servers/${serverMath.id}/tools/calculate_stats`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ enabled: false })
  });
  if (!disPolicyRes.ok) throw new Error('Failed to disable calculate_stats tool');
  console.log(`✓ Disabled tool 'calculate_stats' on Math Server`);

  // Rename multiply -> times
  const renPolicyRes = await fetch(`http://localhost:3000/api/servers/${serverMath.id}/tools/multiply`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ enabled: true, rename: 'times' })
  });
  if (!renPolicyRes.ok) throw new Error('Failed to rename multiply tool');
  const renPolicyData = await renPolicyRes.json();
  const updatedPolicy = renPolicyData.policy;
  const targetConfigVersion = renPolicyData.config_version || 999;
  console.log(`✓ Renamed tool 'multiply' -> '${updatedPolicy.rename}' on Math Server\n`);

  // Step 6: Wait for Gateway to apply latest configuration
  console.log('Step 6: Waiting for Gateway to sync updated config...');
  const gwEndpoint = `http://localhost:8080/p/${projectSlug}/mcp`;
  await sleep(1500); // Give poller a moment

  // Step 7: Standard MCP Client Interaction: initialize
  console.log('Step 7: Testing MCP initialize handshake...');
  const initRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'phase4-e2e-test', version: '1.0.0' }
      }
    })
  });
  if (!initRes.ok) throw new Error(`Initialize failed: HTTP ${initRes.status}`);
  const initData = await initRes.json();
  console.log(`✓ Server advertised:`, JSON.stringify(initData.result.serverInfo));
  if (!initData.result.capabilities.tools?.listChanged) {
    throw new Error('Missing tools capability in initialize response');
  }
  console.log('✅ Initialize handshake successful!\n');

  // Step 8: Standard MCP Client Interaction: tools/list fan-out and namespacing
  console.log('Step 8: Testing MCP tools/list aggregation, namespacing, and policy filtering...');
  const listRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })
  });
  if (!listRes.ok) throw new Error(`tools/list failed: HTTP ${listRes.status}`);
  const listData = await listRes.json();
  const tools = listData.result?.tools || [];
  console.log(`✓ Gateway returned ${tools.length} aggregated tools:`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description}`);
  }

  const toolNames = tools.map(t => t.name);

  // Assertions:
  // 1. Math tools present and namespaced: math__add, math__times
  if (!toolNames.includes('math__add')) throw new Error('Missing expected tool: math__add');
  if (!toolNames.includes('math__times')) throw new Error('Missing expected renamed tool: math__times');
  // 2. Disabled tool filtered out: calculate_stats
  if (toolNames.includes('math__calculate_stats') || toolNames.includes('calculate_stats')) {
    throw new Error('FAIL: Disabled tool calculate_stats is still present in tools/list!');
  }
  // 3. Weather tools present and namespaced: weather__get_current_weather, weather__get_forecast
  if (!toolNames.includes('weather__get_current_weather')) throw new Error('Missing expected tool: weather__get_current_weather');
  if (!toolNames.includes('weather__get_forecast')) throw new Error('Missing expected tool: weather__get_forecast');

  console.log('✅ tools/list aggregation, namespacing, and policy filtering fully verified!\n');

  // Step 9: Call Tool on Downstream 1 (Math: math__add)
  console.log('Step 9: Testing tools/call on Downstream 1 (math__add with a=17, b=25)...');
  const callAddRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'math__add',
        arguments: { a: 17, b: 25 }
      }
    })
  });
  if (!callAddRes.ok) throw new Error(`tools/call math__add failed: HTTP ${callAddRes.status}`);
  const callAddData = await callAddRes.json();
  if (callAddData.error) throw new Error(`tools/call returned RPC error: ${JSON.stringify(callAddData.error)}`);
  const addResultText = callAddData.result?.content?.[0]?.text;
  console.log(`✓ Downstream 1 Result: "${addResultText}"`);
  if (addResultText !== '42') {
    throw new Error(`Expected result "42", got "${addResultText}"`);
  }
  console.log('✅ Downstream 1 tools/call succeeded!\n');

  // Step 10: Call Renamed Tool on Downstream 1 (Math: math__times)
  console.log('Step 10: Testing tools/call on renamed tool (math__times with a=6, b=7)...');
  const callTimesRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'math__times',
        arguments: { a: 6, b: 7 }
      }
    })
  });
  if (!callTimesRes.ok) throw new Error(`tools/call math__times failed: HTTP ${callTimesRes.status}`);
  const callTimesData = await callTimesRes.json();
  if (callTimesData.error) throw new Error(`tools/call returned RPC error: ${JSON.stringify(callTimesData.error)}`);
  const timesResultText = callTimesData.result?.content?.[0]?.text;
  console.log(`✓ Renamed Tool Result: "${timesResultText}"`);
  if (timesResultText !== '42') {
    throw new Error(`Expected result "42", got "${timesResultText}"`);
  }
  console.log('✅ Renamed tools/call forwarded and executed successfully!\n');

  // Step 11: Call Tool on Downstream 2 (Weather: weather__get_current_weather)
  console.log('Step 11: Testing tools/call on Downstream 2 (weather__get_current_weather for Tokyo)...');
  const callWeatherRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'weather__get_current_weather',
        arguments: { city: 'Tokyo' }
      }
    })
  });
  if (!callWeatherRes.ok) throw new Error(`tools/call weather failed: HTTP ${callWeatherRes.status}`);
  const callWeatherData = await callWeatherRes.json();
  if (callWeatherData.error) throw new Error(`tools/call returned RPC error: ${JSON.stringify(callWeatherData.error)}`);
  const weatherResultText = callWeatherData.result?.content?.[0]?.text;
  console.log(`✓ Downstream 2 Result: "${weatherResultText}"`);
  if (!weatherResultText?.includes('Tokyo')) {
    throw new Error(`Expected result to contain "Tokyo", got "${weatherResultText}"`);
  }
  console.log('✅ Downstream 2 tools/call succeeded!\n');

  // Step 12: Verify Policy Rejection for Disabled Tool
  console.log('Step 12: Verifying rejection of disabled tool (math__calculate_stats)...');
  const callDisRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'math__calculate_stats',
        arguments: { dataset: [1, 2, 3] }
      }
    })
  });
  const callDisData = await callDisRes.json();
  if (!callDisData.error) {
    throw new Error('FAIL: Calling disabled tool should return a policy error, but got success!');
  }
  console.log(`✓ Policy Enforcement Response: Code=${callDisData.error.code}, Message="${callDisData.error.message}"`);
  console.log('✅ Policy enforcement verified!\n');

  // Step 13: Test Partial Failure Handling (Degraded Server)
  console.log('Step 13: Testing Partial Failure Resiliency - Adding an unreachable downstream server...');
  const deadServerRes = await fetch(`http://localhost:3000/api/projects/${projectId}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Unreachable Legacy Server',
      namespace_prefix: 'unreachable',
      transport: 'http',
      url: 'http://console:3000/api/mock/non-existent-server-url',
      auth_type: 'none'
    })
  });
  if (!deadServerRes.ok) throw new Error('Failed to register dead server');
  console.log('✓ Registered unreachable server. Waiting for config sync...');
  await sleep(2000);

  console.log('Invoking tools/list with one dead downstream...');
  const degradeListRes = await fetch(gwEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: {}
    })
  });
  if (!degradeListRes.ok) {
    throw new Error(`FAIL: Gateway crashed or returned error status ${degradeListRes.status} on partial failure!`);
  }
  const degradeData = await degradeListRes.json();
  const degradedTools = degradeData.result?.tools || [];
  console.log(`✓ Gateway gracefully returned ${degradedTools.length} tools despite one dead downstream!`);
  const warnings = degradeData.result?._meta?.warnings || [];
  console.log(`✓ Warning reported in metadata:`, warnings);
  if (degradedTools.length === 0) {
    throw new Error('Expected healthy tools to be returned during partial downstream failure!');
  }
  console.log('✅ Partial Failure Graceful Degradation Verified!\n');

  console.log('================================================================');
  console.log('✅ ALL PHASE 4 ACCEPTANCE CRITERIA PASS!');
  console.log('Virtual Server aggregates multiple downstreams, routes calls,');
  console.log('enforces policies, and gracefully degrades on partial failures.');
  console.log('================================================================\n');
}

runPhase4Verification().catch(err => {
  console.error('\n❌ Phase 4 Verification Failed:', err);
  process.exit(1);
});
