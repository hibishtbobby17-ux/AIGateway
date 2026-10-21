import { NextRequest, NextResponse } from 'next/server';
import { revokeRefreshToken } from '@/lib/idp';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = body.token || body.refresh_token;

    if (!token) {
      return NextResponse.json({ error: 'missing token' }, { status: 400 });
    }

    revokeRefreshToken(token);
    return NextResponse.json({ status: 'revoked' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
