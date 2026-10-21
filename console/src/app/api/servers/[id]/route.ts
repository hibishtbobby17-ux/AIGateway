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
    const serverRes = await pool.query(`
      SELECT s.*, p.org_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `, [params.id, session.orgId]);

    if (serverRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    return NextResponse.json({ server: serverRes.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, namespace_prefix, url, enabled, timeouts, auth_type } = body;

    await initDatabase();

    const updRes = await pool.query(`
      UPDATE mcp_servers s
      SET 
        name = COALESCE($1, s.name),
        namespace_prefix = COALESCE($2, s.namespace_prefix),
        url = COALESCE($3, s.url),
        enabled = COALESCE($4, s.enabled),
        timeouts = COALESCE($5, s.timeouts),
        auth_type = COALESCE($6, s.auth_type),
        updated_at = NOW()
      FROM projects p
      WHERE s.id = $7 AND p.id = s.project_id AND p.org_id = $8
      RETURNING s.*, s.project_id
    `, [
      name || null,
      namespace_prefix || null,
      url || null,
      enabled !== undefined ? enabled : null,
      timeouts ? JSON.stringify(timeouts) : null,
      auth_type || null,
      params.id,
      session.orgId
    ]);

    if (updRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    const projectId = updRes.rows[0].project_id;
    await pool.query(
      'UPDATE projects SET config_version = config_version + 1, updated_at = NOW() WHERE id = $1',
      [projectId]
    );

    return NextResponse.json({ server: updRes.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const findRes = await pool.query(`
      SELECT s.id, s.project_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `, [params.id, session.orgId]);

    if (findRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    const projectId = findRes.rows[0].project_id;
    await pool.query('DELETE FROM mcp_servers WHERE id = $1', [params.id]);

    await pool.query(
      'UPDATE projects SET config_version = config_version + 1, updated_at = NOW() WHERE id = $1',
      [projectId]
    );

    return NextResponse.json({ success: true, deleted_id: params.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
