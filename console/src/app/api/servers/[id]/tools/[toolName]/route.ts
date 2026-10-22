import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string; toolName: string } }
) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { enabled, rename } = body;

    await initDatabase();

    const serverRes = await pool.query(`
      SELECT s.id, s.project_id
      FROM mcp_servers s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = $1 AND p.org_id = $2
    `, [params.id, session.orgId]);

    if (serverRes.rows.length === 0) {
      return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
    }

    const projectId = serverRes.rows[0].project_id;
    const decodedToolName = decodeURIComponent(params.toolName);

    // Upsert tool policy
    const updRes = await pool.query(`
      INSERT INTO tool_policies (mcp_server_id, tool_name, enabled, rename)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (mcp_server_id, tool_name)
      DO UPDATE SET 
        enabled = EXCLUDED.enabled,
        rename = EXCLUDED.rename,
        updated_at = NOW()
      RETURNING *
    `, [
      params.id,
      decodedToolName,
      enabled !== undefined ? enabled : true,
      rename || null,
    ]);

    // Increment config_version for atomic swap propagation
    await pool.query(
      'UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE id = $1',
      [projectId]
    );

    const policy = updRes.rows[0];

    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'tool_policy.update',
      target: `tool:${decodedToolName} on server:${params.id}`,
      diff: { enabled: policy.enabled, rename: policy.rename },
    });

    return NextResponse.json({ policy });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
