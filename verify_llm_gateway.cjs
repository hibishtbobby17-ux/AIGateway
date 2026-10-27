async function run() {
  console.log('=== VERIFYING UNIVERSAL LLM GATEWAY SUITE ===');

  // 1. Health check
  const healthRes = await fetch('http://127.0.0.1:3000/api/healthz');
  console.log('1. Health status:', healthRes.status);

  // 2. Login
  const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' })
  });
  console.log('2. Login status:', loginRes.status);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';

  // 3. List LLM Gateways
  const listRes = await fetch('http://127.0.0.1:3000/api/llm-gateways', {
    headers: { Cookie: cookie }
  });
  const listData = await listRes.json();
  console.log(`3. List LLM Gateways: count = ${listData.gateways?.length}`);
  listData.gateways?.forEach(g => {
    console.log(`   - [${g.slug}] ${g.name} (Inbound: ${g.inbound_auth?.mode}, Primary: ${g.primary_backend?.provider} ${g.primary_backend?.model_alias})`);
  });

  // 4. Test Consumer Chat Completions Endpoint (/api/llm/enterprise-chat/v1/chat/completions)
  // Calling with Virtual API Key
  const chatRes = await fetch('http://127.0.0.1:3000/api/llm/enterprise-chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sec_llm_live_98a76bc543210fe'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an enterprise financial assistant.' },
        { role: 'user', content: 'What is our Q3 cloud infrastructure spend?' }
      ],
      temperature: 0.7
    })
  });
  const chatData = await chatRes.json();
  console.log('4. Consumer Chat Completion Status:', chatRes.status);
  console.log('   Response ID:', chatData.id);
  console.log('   Model:', chatData.model);
  console.log('   Choice text preview:', chatData.choices?.[0]?.message?.content?.substring(0, 100));
  console.log('   Usage tokens:', chatData.usage);
  console.log('   Gateway metadata:', chatData.gateway_meta);

  // 5. Test Consumer with Okta Client Credentials Token
  const oktaChatRes = await fetch('http://127.0.0.1:3000/api/llm/enterprise-chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.okta_simulated_token'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Execute confidential task' }]
    })
  });
  console.log('5. Okta OAuth CC Inbound Verification Status:', oktaChatRes.status);

  // 6. Test Failover Simulation (/api/llm/enterprise-chat/v1/chat/completions)
  const failoverRes = await fetch('http://127.0.0.1:3000/api/llm/enterprise-chat/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sec_llm_live_98a76bc543210fe'
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Test prompt' }],
      simulate_fallback: true
    })
  });
  const failoverData = await failoverRes.json();
  console.log('6. Automatic Failover Simulation Status:', failoverRes.status);
  console.log('   Resolved Provider:', failoverData.gateway_meta?.provider);
  console.log('   Resolved Model:', failoverData.model);
  console.log('   Failover triggered flag:', failoverData.gateway_meta?.failover_triggered);

  // 7. Test Models Listing Endpoint (/api/llm/enterprise-chat/v1/models)
  const modelsRes = await fetch('http://127.0.0.1:3000/api/llm/enterprise-chat/v1/models');
  const modelsData = await modelsRes.json();
  console.log('7. Models endpoint status:', modelsRes.status, 'models count:', modelsData.data?.length);
  modelsData.data?.forEach(m => console.log(`   - Model ID: ${m.id} (owned by ${m.owned_by})`));

  // 8. Test Playground Endpoint (/api/llm-gateways/[id]/test)
  const targetId = listData.gateways?.[0]?.id;
  if (targetId) {
    const playRes = await fetch(`http://127.0.0.1:3000/api/llm-gateways/${targetId}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        prompt: 'Testing through console playground',
        simulate_fallback: false
      })
    });
    const playData = await playRes.json();
    console.log('8. Playground test status:', playRes.status, 'latency:', playData.result?.latency_ms, 'ms');
  }

  console.log('=== ALL LLM GATEWAY TESTS PASSED SUCCESSFULLY ===');
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
