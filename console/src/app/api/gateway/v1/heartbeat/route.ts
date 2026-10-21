import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized gateway' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: 'Invalid gateway token' }, { status: 401 });
    }

    const body = await req.json();
    const { version, applied_config_version, metrics } = body;
    const gatewayId = payload.gatewayId;

    await initDatabase();

    await pool.query(`
      UPDATE gateway_instances
      SET 
        last_seen_at = NOW(),
        version = COALESCE($1, version),
        applied_config_version = COALESCE($2, applied_config_version),
        status = 'active',
        updated_at = NOW()
      WHERE id = $3
    `, [
      version || null,
      applied_config_version !== undefined ? applied_config_version : null,
      gatewayId
    ]);

    const maxVerRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
    const latestConfigVersion = parseInt(maxVerRes.rows[0].max_version, 10);

    return NextResponse.json({
      status: 'acknowledged',
      gateway_id: gatewayId,
      applied_config_version,
      latest_config_version: latestConfigVersion,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
