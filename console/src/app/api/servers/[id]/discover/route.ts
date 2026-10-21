import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const serverRes = await pool.query(`
      SELECT s.*, p.id as project_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `, [params.id, session.orgId]);

    if (serverRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    const server = serverRes.rows[0];
    let targetUrl = server.url;
    if (targetUrl.includes('localhost:3000')) {
      targetUrl = targetUrl.replace('localhost:3000', '127.0.0.1:3000');
    }

    // Call downstream tools/list
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return NextResponse.json({
        error: `Downstream MCP server returned HTTP ${resp.status}`,
      }, { status: 502 });
    }

    const jsonRpcRes = await resp.json();
    if (jsonRpcRes.error) {
      return NextResponse.json({
        error: `Downstream JSON-RPC error: ${jsonRpcRes.error.message || 'Unknown error'}`,
      }, { status: 502 });
    }

    const tools = jsonRpcRes.result?.tools || [];
    let addedCount = 0;

    // Fetch existing policies
    const existingPolicies = await pool.query(
      'SELECT id, tool_name, enabled, rename FROM tool_policies WHERE mcp_server_id = $1',
      [params.id]
    );

    const policyMap = new Map<string, { id: string; enabled: boolean; rename: string | null }>();
    for (const p of existingPolicies.rows) {
      policyMap.set(p.tool_name, { id: p.id, enabled: p.enabled, rename: p.rename });
    }

    const discoveredTools = [];

    for (const tool of tools) {
      let policy = policyMap.get(tool.name);
      if (!policy) {
        // Insert default enabled policy
        const insPol = await pool.query(`
          INSERT INTO tool_policies (mcp_server_id, tool_name, enabled)
          VALUES ($1, $2, true)
          RETURNING id, tool_name, enabled, rename
        `, [params.id, tool.name]);
        policy = insPol.rows[0];
        addedCount++;
      }

      discoveredTools.push({
        id: policy?.id,
        name: tool.name,
        virtual_name: `${server.namespace_prefix}__${policy?.rename || tool.name}`,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        enabled: policy ? policy.enabled : true,
        rename: policy?.rename || null,
        server_id: server.id,
        server_name: server.name,
        namespace_prefix: server.namespace_prefix,
      });
    }

    // Update server health to healthy & timestamp
    await pool.query(`
      UPDATE mcp_servers
      SET health_status = 'healthy', last_checked_at = NOW()
      WHERE id = $1
    `, [params.id]);

    if (addedCount > 0) {
      await pool.query(
        'UPDATE projects SET config_version = config_version + 1, updated_at = NOW() WHERE id = $1',
        [server.project_id]
      );
    }

    return NextResponse.json({
      success: true,
      server_id: server.id,
      server_name: server.name,
      tools_count: discoveredTools.length,
      new_tools_added: addedCount,
      tools: discoveredTools,
    });
  } catch (err: any) {
    console.error('Tool discovery failed:', err);
    return NextResponse.json({ error: err.message || 'Discovery request timed out' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const policies = await pool.query(`
      SELECT 
        p.id,
        p.tool_name,
        p.enabled,
        p.rename,
        s.id as server_id,
        s.name as server_name,
        s.namespace_prefix,
        CONCAT(s.namespace_prefix, '__', COALESCE(p.rename, p.tool_name)) as virtual_name
      FROM tool_policies p
      JOIN mcp_servers s ON s.id = p.mcp_server_id
      JOIN projects pr ON pr.id = s.project_id
      WHERE s.id = $1 AND pr.org_id = $2
      ORDER BY p.tool_name ASC
    `, [params.id, session.orgId]);

    return NextResponse.json({ tools: policies.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
