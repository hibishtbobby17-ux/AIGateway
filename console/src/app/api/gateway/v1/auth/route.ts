import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gateway_id, secret } = body;

    if (!gateway_id || !secret) {
      return NextResponse.json({ error: 'gateway_id and secret are required' }, { status: 400 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT id, name, secret_hash, status, revoked_at
      FROM gateway_instances
      WHERE (name = $1 OR id::text = $1)
    `, [gateway_id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid gateway credentials' }, { status: 401 });
    }

    const gateway = gwRes.rows[0];

    if (gateway.status === 'revoked' || gateway.revoked_at !== null) {
      return NextResponse.json({ error: 'Gateway instance has been revoked' }, { status: 403 });
    }

    const isValid = await bcrypt.compare(secret, gateway.secret_hash);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid gateway secret' }, { status: 401 });
    }

    const token = jwt.sign(
      {
        gatewayId: gateway.id,
        gatewayName: gateway.name,
        type: 'gateway'
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    return NextResponse.json({
      token,
      token_type: 'Bearer',
      expires_in: 3600,
      gateway_id: gateway.id,
      gateway_name: gateway.name
    });
  } catch (err: any) {
    console.error('Gateway auth error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
