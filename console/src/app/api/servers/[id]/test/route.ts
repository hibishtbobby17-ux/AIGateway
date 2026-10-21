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
      SELECT s.*
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `, [params.id, session.orgId]);

    if (serverRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    const server = serverRes.rows[0];
    let targetUrl = server.url;

    // In Docker, if the URL references localhost or 127.0.0.1 and target is internal console, replace with 127.0.0.1
    if (targetUrl.includes('localhost:3000')) {
      targetUrl = targetUrl.replace('localhost:3000', '127.0.0.1:3000');
    }

    const startTime = Date.now();
    let healthStatus = 'unhealthy';
    let latencyMs = 0;
    let serverInfo = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'AI-Console-Inspector', version: '1.0.0' }
          },
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      latencyMs = Date.now() - startTime;

      if (resp.ok) {
        const data = await resp.json();
        if (data.result) {
          healthStatus = 'healthy';
          serverInfo = data.result.serverInfo || null;
        } else {
          healthStatus = 'healthy';
        }
      } else {
        healthStatus = 'unhealthy';
      }
    } catch (fetchErr: any) {
      latencyMs = Date.now() - startTime;
      healthStatus = 'unhealthy';
    }

    // Persist health status in DB
    await pool.query(`
      UPDATE mcp_servers
      SET health_status = $1, last_checked_at = NOW()
      WHERE id = $2
    `, [healthStatus, params.id]);

    return NextResponse.json({
      success: healthStatus === 'healthy',
      status: healthStatus,
      latency_ms: latencyMs,
      server_info: serverInfo,
      checked_url: targetUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
