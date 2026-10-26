async function verify() {
  console.log('--- 1. Login to Console ---');
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' }),
  });
  if (!loginRes.ok) throw new Error('Login failed: ' + (await loginRes.text()));
  const loginData = await loginRes.json();
  const token = loginData.token;
  const cookie = loginRes.headers.get('set-cookie');
  console.log('✓ Successfully authenticated as:', loginData.user.email);

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(cookie ? { 'Cookie': cookie } : {})
  };

  console.log('\n--- 2. Fetch Gateway Fleet ---');
  const gwListRes = await fetch('http://localhost:3000/api/gateways', { headers: authHeaders });
  if (!gwListRes.ok) throw new Error('Failed to fetch gateways: ' + (await gwListRes.text()));
  const gwListData = await gwListRes.json();
  console.log(`✓ Fetched ${gwListData.gateways?.length || 0} gateway instance(s)`);
  const firstGw = gwListData.gateways[0];
  console.log('Sample Gateway:', { id: firstGw.id, name: firstGw.name, status: firstGw.status });

  console.log('\n--- 3. Test Inspect Gateway via UUID ---');
  const inspectByIdRes = await fetch(`http://localhost:3000/api/gateways/${firstGw.id}`, { headers: authHeaders });
  if (!inspectByIdRes.ok) throw new Error('Inspect by ID failed: ' + (await inspectByIdRes.text()));
  const inspectByIdData = await inspectByIdRes.json();
  console.log('✓ Inspect by UUID returned gateway:', inspectByIdData.gateway?.name);
  console.log(`✓ Gateway serves ${inspectByIdData.endpoints?.length || 0} endpoint(s)`);

  console.log('\n--- 4. Test Inspect Gateway via Name (e.g. "gateway-default-01") ---');
  const inspectByNameRes = await fetch(`http://localhost:3000/api/gateways/${firstGw.name}`, { headers: authHeaders });
  if (!inspectByNameRes.ok) throw new Error('Inspect by Name failed: ' + (await inspectByNameRes.text()));
  const inspectByNameData = await inspectByNameRes.json();
  console.log('✓ Inspect by Name returned gateway:', inspectByNameData.gateway?.name);

  console.log('\n--- 5. Test Certificates & Settings API ---');
  const settingsGetRes = await fetch('http://localhost:3000/api/settings', { headers: authHeaders });
  if (!settingsGetRes.ok) throw new Error('GET /api/settings failed: ' + (await settingsGetRes.text()));
  const settingsData = await settingsGetRes.json();
  console.log('✓ Retrieved settings: Inbound Protocol =', settingsData.settings?.tls?.inbound?.protocol);
  console.log('✓ TLS Min Version =', settingsData.settings?.tls?.inbound?.min_version);

  console.log('\n--- 6. Test Updating Certificate Settings ---');
  const settingsPutRes = await fetch('http://localhost:3000/api/settings', {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      settings: {
        tls: {
          inbound: {
            protocol: 'https',
            cert_mode: 'auto_cert',
            min_version: 'TLS 1.3',
            sans: ['localhost', '127.0.0.1', 'ai-gateway.local']
          }
        }
      }
    })
  });
  if (!settingsPutRes.ok) throw new Error('PUT /api/settings failed: ' + (await settingsPutRes.text()));
  const putSettingsData = await settingsPutRes.json();
  console.log('✓ Updated settings successfully:', putSettingsData.message);

  console.log('\n--- 7. Test Project Policy Configuration & Enforcement ---');
  const projListRes = await fetch('http://localhost:3000/api/projects', { headers: authHeaders });
  const projListData = await projListRes.json();
  const testProject = projListData.projects[0];
  console.log('Target Project for Policy:', { id: testProject.id, name: testProject.name, slug: testProject.slug });

  const policyPutRes = await fetch(`http://localhost:3000/api/projects/${testProject.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      settings: {
        inbound_auth: {
          mode: 'oauth_jwt',
          required_scopes: ['mcp:tools', 'mcp:read'],
          issuer: 'https://auth.company.local',
          audience: 'ai-gateway'
        },
        rate_limits: {
          requests_per_minute: 1200,
          burst: 100,
          key_strategy: 'jwt_subject'
        },
        circuit_breaker: {
          max_failures: 3,
          recovery_seconds: 15,
          dial_timeout_ms: 3000,
          call_timeout_ms: 10000
        },
        fail_static_cache: true
      }
    })
  });
  if (!policyPutRes.ok) throw new Error('PUT /api/projects/[id] policy failed: ' + (await policyPutRes.text()));
  const updatedProjData = await policyPutRes.json();
  console.log('✓ Project Policy Enforced! New config version: v' + updatedProjData.project.config_version);
  console.log('✓ Enforced Inbound Auth Mode:', updatedProjData.project.settings.inbound_auth.mode);
  console.log('✓ Enforced Rate Limit:', updatedProjData.project.settings.rate_limits.requests_per_minute, 'req/min');

  console.log('\n=============================================');
  console.log('🎉 ALL GATEWAY INSPECT & CONFIGURATION TESTS PASSED!');
  console.log('=============================================');
}

verify().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
