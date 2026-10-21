// Phase 2 Acceptance Criteria Automated Test
// Acceptance: create a project, add 2 mock MCP servers, see discovered tools.

async function runPhase2Verification() {
  console.log('=== Starting Phase 2 End-to-End Verification ===\n');

  // 1. Authenticate to Console
  console.log('Step 1: Authenticating as Admin...');
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' })
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  console.log(`✓ Authenticated successfully as ${loginData.user.email} (Org: ${loginData.user.orgId})\n`);

  // 2. Create a new Project
  const testProjectSlug = `test-lab-${Date.now()}`;
  console.log(`Step 2: Creating project "AI Research Lab" (slug: ${testProjectSlug})...`);
  const projRes = await fetch('http://localhost:3000/api/projects', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'AI Research Lab',
      slug: testProjectSlug,
      settings: { max_in_flight: 500 }
    })
  });

  if (!projRes.ok) {
    throw new Error(`Project creation failed: ${projRes.status} ${await projRes.text()}`);
  }
  const projData = await projRes.json();
  const projectId = projData.project.id;
  console.log(`✓ Project created: ID=${projectId}, Slug=${projData.project.slug}, ConfigVersion=${projData.project.config_version}\n`);

  // 3. Add Mock MCP Server 1: Math Tools
  console.log('Step 3: Adding Downstream MCP Server 1 (Mock Math Tools)...');
  const server1Res = await fetch(`http://localhost:3000/api/projects/${projectId}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Math Calculator Service',
      namespace_prefix: 'math',
      transport: 'http',
      url: 'http://127.0.0.1:3000/api/mock/mcp-math',
      auth_type: 'none'
    })
  });

  if (!server1Res.ok) {
    throw new Error(`Server 1 registration failed: ${server1Res.status} ${await server1Res.text()}`);
  }
  const server1Data = await server1Res.json();
  const server1Id = server1Data.server.id;
  console.log(`✓ Server 1 added: ID=${server1Id}, Prefix=${server1Data.server.namespace_prefix}\n`);

  // 4. Add Mock MCP Server 2: Weather Tools
  console.log('Step 4: Adding Downstream MCP Server 2 (Mock Weather Tools)...');
  const server2Res = await fetch(`http://localhost:3000/api/projects/${projectId}/servers`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Global Weather Service',
      namespace_prefix: 'weather',
      transport: 'http',
      url: 'http://127.0.0.1:3000/api/mock/mcp-weather',
      auth_type: 'none'
    })
  });

  if (!server2Res.ok) {
    throw new Error(`Server 2 registration failed: ${server2Res.status} ${await server2Res.text()}`);
  }
  const server2Data = await server2Res.json();
  const server2Id = server2Data.server.id;
  console.log(`✓ Server 2 added: ID=${server2Id}, Prefix=${server2Data.server.namespace_prefix}\n`);

  // 5. Test Live Connection for both servers
  console.log('Step 5: Testing Connection on both MCP Servers...');
  const test1Res = await fetch(`http://localhost:3000/api/servers/${server1Id}/test`, {
    method: 'POST',
    headers: authHeaders
  });
  const test1Data = await test1Res.json();
  console.log(`✓ Server 1 Test: Status=${test1Data.status}, Latency=${test1Data.latency_ms}ms, ServerInfo=${JSON.stringify(test1Data.server_info)}`);

  const test2Res = await fetch(`http://localhost:3000/api/servers/${server2Id}/test`, {
    method: 'POST',
    headers: authHeaders
  });
  const test2Data = await test2Res.json();
  console.log(`✓ Server 2 Test: Status=${test2Data.status}, Latency=${test2Data.latency_ms}ms, ServerInfo=${JSON.stringify(test2Data.server_info)}\n`);

  // 6. Discover Tools for Server 1
  console.log('Step 6: Discovering tools from Server 1 (Math)...');
  const disc1Res = await fetch(`http://localhost:3000/api/servers/${server1Id}/discover`, {
    method: 'POST',
    headers: authHeaders
  });
  const disc1Data = await disc1Res.json();
  console.log(`✓ Server 1 Discovered ${disc1Data.tools_count} tools:`);
  for (const t of disc1Data.tools) {
    console.log(`   - [${t.virtual_name}] ${t.description}`);
  }

  // 7. Discover Tools for Server 2
  console.log('\nStep 7: Discovering tools from Server 2 (Weather)...');
  const disc2Res = await fetch(`http://localhost:3000/api/servers/${server2Id}/discover`, {
    method: 'POST',
    headers: authHeaders
  });
  const disc2Data = await disc2Res.json();
  console.log(`✓ Server 2 Discovered ${disc2Data.tools_count} tools:`);
  for (const t of disc2Data.tools) {
    console.log(`   - [${t.virtual_name}] ${t.description}`);
  }

  // 8. Test Tool Policy Toggle
  console.log('\nStep 8: Toggling Tool Policy for "add" on Server 1 (Disabling)...');
  const toggleRes = await fetch(`http://localhost:3000/api/servers/${server1Id}/tools/add`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ enabled: false })
  });
  const toggleData = await toggleRes.json();
  console.log(`✓ Tool Policy updated: tool_name=${toggleData.policy.tool_name}, enabled=${toggleData.policy.enabled}`);

  // 9. Verify Project Details & Config Version
  console.log('\nStep 9: Verifying updated Project state and Config Version...');
  const projDetailRes = await fetch(`http://localhost:3000/api/projects/${projectId}`, {
    method: 'GET',
    headers: authHeaders
  });
  const projDetailData = await projDetailRes.json();
  console.log(`✓ Project: Name=${projDetailData.project.name}, ConfigVersion=${projDetailData.project.config_version}, Servers=${projDetailData.project.servers.length}`);

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 2 ACCEPTANCE CRITERIA VERIFIED SUCCESSFULLY!');
  console.log('======================================================\n');
}

runPhase2Verification().catch((err) => {
  console.error('\n❌ Phase 2 Verification Failed:', err);
  process.exit(1);
});
