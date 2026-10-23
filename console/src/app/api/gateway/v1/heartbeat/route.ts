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
    const protocol = body.protocol || metrics?.protocol || 'http';
    const tlsEnabled = body.tls_enabled ?? metrics?.tls_enabled ?? (protocol === 'https');
    const gatewayId = payload.gatewayId;

    await initDatabase();

    const gwCheck = await pool.query(`
      SELECT id, status, revoked_at FROM gateway_instances WHERE id = $1
    `, [gatewayId]);

    if (gwCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    if (gwCheck.rows[0].status === 'revoked' || gwCheck.rows[0].revoked_at !== null) {
      return NextResponse.json({ error: 'Gateway instance has been revoked' }, { status: 403 });
    }

    await pool.query(`
      UPDATE gateway_instances
      SET 
        last_seen_at = NOW(),
        version = COALESCE($1, version),
        applied_config_version = COALESCE($2, applied_config_version),
        protocol = COALESCE($3, protocol),
        tls_enabled = COALESCE($4, tls_enabled),
        metrics = COALESCE($5, metrics),
        status = 'active',
        updated_at = NOW()
      WHERE id = $6
    `, [
      version || null,
      applied_config_version !== undefined ? applied_config_version : null,
      protocol,
      tlsEnabled,
      metrics ? JSON.stringify(metrics) : null,
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
