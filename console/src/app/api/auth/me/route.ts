import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';
import { pool, initDatabase } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    let token = req.cookies.get('gateway_console_session')?.value;
    if (!token) {
      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = verifySessionToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    await initDatabase();
    const orgRes = await pool.query('SELECT id, name, slug FROM organizations WHERE id = $1', [session.orgId]);
    const organization = orgRes.rows[0] || null;

    return NextResponse.json({
      user: session,
      organization,
    });
  } catch (err: any) {
    console.error('Session verification error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
