import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const actor = searchParams.get('actor');
    const target = searchParams.get('target');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = `
      SELECT id, org_id, actor, action, target, timestamp, diff
      FROM audit_logs
      WHERE org_id = $1
    `;
    const params: any[] = [session.orgId];
    let paramIdx = 2;

    if (action) {
      query += ` AND action ILIKE $${paramIdx++}`;
      params.push(`%${action}%`);
    }
    if (actor) {
      query += ` AND actor ILIKE $${paramIdx++}`;
      params.push(`%${actor}%`);
    }
    if (target) {
      query += ` AND target ILIKE $${paramIdx++}`;
      params.push(`%${target}%`);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return NextResponse.json({
      audit_logs: result.rows,
      count: result.rows.length,
      limit,
      offset,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
