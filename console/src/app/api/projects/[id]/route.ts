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
    const projRes = await pool.query(`
      SELECT id, org_id, name, slug, status, settings, config_version, created_at, updated_at
      FROM projects
      WHERE id = $1 AND org_id = $2
    `, [params.id, session.orgId]);

    if (projRes.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = projRes.rows[0];

    // Fetch servers for this project
    const serversRes = await pool.query(`
      SELECT 
        s.id,
        s.name,
        s.namespace_prefix,
        s.transport,
        s.url,
        s.auth_type,
        s.timeouts,
        s.enabled,
        s.health_status,
        s.last_checked_at,
        COUNT(p.id)::int as tool_count
      FROM mcp_servers s
      LEFT JOIN tool_policies p ON p.mcp_server_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at ASC
    `, [params.id]);

    return NextResponse.json({
      project: {
        ...project,
        servers: serversRes.rows,
      }
    });
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
    const { name, status, settings } = body;

    await initDatabase();

    const updRes = await pool.query(`
      UPDATE projects
      SET 
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        settings = COALESCE($3, settings),
        config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects),
        updated_at = NOW()
      WHERE id = $4 AND org_id = $5
      RETURNING id, org_id, name, slug, status, settings, config_version, updated_at
    `, [
      name ? name.trim() : null,
      status || null,
      settings ? JSON.stringify(settings) : null,
      params.id,
      session.orgId
    ]);

    if (updRes.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ project: updRes.rows[0] });
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
    const delRes = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id',
      [params.id, session.orgId]
    );

    if (delRes.rows.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: params.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
