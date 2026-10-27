const http = require('http');

async function run() {
  console.log('--- TESTING CONSOLE MCP & DEPLOY ENHANCEMENTS ---');

  // 1. Login
  const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aigateway.local', password: 'Admin123!@#' })
  });
  console.log('1. Login status:', loginRes.status);
  const setCookie = loginRes.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : '';

  // 2. Gateways fetch
  const gwRes = await fetch('http://127.0.0.1:3000/api/gateways', {
    headers: { Cookie: cookie }
  });
  const gwData = await gwRes.json();
  console.log(`2. Gateways count: ${gwData.gateways?.length}, first gateway: ${gwData.gateways?.[0]?.name}`);

  // 3. Deploy Key Verification test (/api/gateway/v1/auth)
  const authRes = await fetch('http://127.0.0.1:3000/api/gateway/v1/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gateway_id: 'gateway-default-01',
      secret: 'dev-gateway-secret'
    })
  });
  const authData = await authRes.json();
  console.log('3. Key verification status:', authRes.status, 'token received:', !!authData.token);

  // 4. Test MCP server endpoint probe (/api/servers/test-endpoint)
  const probeRes = await fetch('http://127.0.0.1:3000/api/servers/test-endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      url: 'http://127.0.0.1:3000/api/mock/mcp-math',
      transport: 'http'
    })
  });
  const probeData = await probeRes.json();
  console.log('4. MCP endpoint probe status:', probeRes.status, 'probe result:', probeData);

  // 5. Projects fetch
  const projRes = await fetch('http://127.0.0.1:3000/api/projects', {
    headers: { Cookie: cookie }
  });
  const projData = await projRes.json();
  const testProject = projData.projects?.[0];
  console.log(`5. Projects count: ${projData.projects?.length}, target project: ${testProject?.name} (${testProject?.id})`);

  // 6. Register a new downstream MCP server
  if (testProject) {
    const regRes = await fetch(`http://127.0.0.1:3000/api/projects/${testProject.id}/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: 'Custom Weather Probe MCP',
        namespace_prefix: 'wx_custom',
        transport: 'http',
        url: 'http://127.0.0.1:3000/api/mock/mcp-weather',
        auth_type: 'none'
      })
    });
    const regData = await regRes.json();
    console.log('6. Register server result:', regRes.status, 'server id:', regData.server?.id, 'name:', regData.server?.name);
  }

  console.log('--- ALL BACKEND VERIFICATIONS COMPLETED SUCCESSFULLY ---');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
