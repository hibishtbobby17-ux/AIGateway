import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT id, name, status, revoked_at
      FROM gateway_instances
      WHERE id = $1
    `, [params.id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    const gateway = gwRes.rows[0];

    await pool.query(`
      UPDATE gateway_instances
      SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [params.id]);

    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'gateway.revoke',
      target: `gateway:${gateway.name} (${gateway.id})`,
      diff: { status: 'revoked', previous_status: gateway.status },
    });

    return NextResponse.json({
      success: true,
      gateway_id: gateway.id,
      name: gateway.name,
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      message: 'Gateway revoked successfully. Further authentication requests will be rejected.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
