import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    // Verify project belongs to org
    const projCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND org_id = $2',
      [params.id, session.orgId]
    );
    if (projCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const servers = await pool.query(`
      SELECT 
        s.id,
        s.project_id,
        s.name,
        s.namespace_prefix,
        s.transport,
        s.url,
        s.auth_type,
        s.timeouts,
        s.enabled,
        s.health_status,
        s.last_checked_at,
        s.created_at,
        s.updated_at,
        COUNT(p.id)::int as tools_count
      FROM mcp_servers s
      LEFT JOIN tool_policies p ON p.mcp_server_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `, [params.id]);

    return NextResponse.json({ servers: servers.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, namespace_prefix, transport, url, auth_type, timeouts, enabled } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Server name is required' }, { status: 400 });
    }
    if (!url || !url.trim()) {
      return NextResponse.json({ error: 'Server URL is required' }, { status: 400 });
    }

    // SSRF Validation
    const { validateSSRF, SSRFError } = await import('@/lib/ssrf');
    try {
      await validateSSRF(url.trim());
    } catch (ssrfErr: any) {
      if (ssrfErr instanceof SSRFError) {
        return NextResponse.json({ error: `SSRF Policy Violation: ${ssrfErr.message}` }, { status: 400 });
      }
      return NextResponse.json({ error: `URL Validation Error: ${ssrfErr.message}` }, { status: 400 });
    }

    const cleanPrefix = (namespace_prefix || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    await initDatabase();

    // Verify project ownership
    const projCheck = await pool.query(
      'SELECT id, slug FROM projects WHERE id = $1 AND org_id = $2',
      [params.id, session.orgId]
    );
    if (projCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const projectSlug = projCheck.rows[0].slug;

    const insRes = await pool.query(`
      INSERT INTO mcp_servers (
        project_id, name, namespace_prefix, transport, url, auth_type, timeouts, enabled, health_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *
    `, [
      params.id,
      name.trim(),
      cleanPrefix || 'mcp',
      transport || 'http',
      url.trim(),
      auth_type || 'none',
      JSON.stringify(timeouts || { dial_ms: 5000, call_ms: 15000 }),
      enabled !== undefined ? enabled : true,
    ]);

    const createdServer = insRes.rows[0];

    // Increment project config_version
    await pool.query(
      'UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE id = $1',
      [params.id]
    );

    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'server.create',
      target: `server:${createdServer.name} in project:${projectSlug}`,
      diff: { name: createdServer.name, url: createdServer.url, transport: createdServer.transport, auth_type: createdServer.auth_type },
    });

    return NextResponse.json({ server: createdServer }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
