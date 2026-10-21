import { NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';

export async function GET() {
  try {
    await initDatabase();
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ok', service: 'console', timestamp: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { status: 'error', error: err.message || 'Database unavailable' },
      { status: 503 }
    );
  }
}
