import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const result = await pool.query(`
      SELECT 
        id,
        name,
        last_seen_at,
        version,
        applied_config_version,
        status,
        revoked_at,
        created_at,
        updated_at
      FROM gateway_instances
      ORDER BY created_at ASC
    `);

    return NextResponse.json({ gateways: result.rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Gateway name is required' }, { status: 400 });
    }

    await initDatabase();

    // Generate random secure secret
    const rawSecret = 'gwsec_' + crypto.randomBytes(24).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const secretHash = await bcrypt.hash(rawSecret, salt);

    const insRes = await pool.query(`
      INSERT INTO gateway_instances (name, secret_hash, status, version)
      VALUES ($1, $2, 'registered', '1.0.0')
      RETURNING id, name, status, version, created_at
    `, [name.trim(), secretHash]);

    return NextResponse.json({
      gateway: insRes.rows[0],
      secret: rawSecret, // Return plaintext secret ONCE to operator
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
