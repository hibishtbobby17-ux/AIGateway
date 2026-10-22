import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT id, name, last_seen_at, version, applied_config_version, status, revoked_at, created_at, updated_at
      FROM gateway_instances
      WHERE id = $1
    `, [params.id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    return NextResponse.json({ gateway: gwRes.rows[0] });
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

    const gwRes = await pool.query(`
      SELECT id, name FROM gateway_instances WHERE id = $1
    `, [params.id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    const gateway = gwRes.rows[0];

    await pool.query('DELETE FROM gateway_instances WHERE id = $1', [params.id]);

    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'gateway.delete',
      target: `gateway:${gateway.name} (${gateway.id})`,
    });

    return NextResponse.json({ success: true, message: 'Gateway instance deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
