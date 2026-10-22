import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { logAudit } from '@/lib/audit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

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
    if (gateway.status === 'revoked' || gateway.revoked_at !== null) {
      return NextResponse.json({ error: 'Cannot rotate secret for a revoked gateway' }, { status: 400 });
    }

    // Generate new secure secret
    const newRawSecret = 'gwsec_' + crypto.randomBytes(24).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const newSecretHash = await bcrypt.hash(newRawSecret, salt);

    await pool.query(`
      UPDATE gateway_instances
      SET secret_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [newSecretHash, params.id]);

    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'gateway.rotate_secret',
      target: `gateway:${gateway.name} (${gateway.id})`,
      diff: { action: 'rotated secret', gateway_id: gateway.id },
    });

    return NextResponse.json({
      success: true,
      gateway_id: gateway.id,
      name: gateway.name,
      secret: newRawSecret, // Return plaintext secret ONCE
      message: 'Gateway secret rotated successfully. Store this secret safely.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
