import { NextResponse } from 'next/server';
import { getMockIdpJwks } from '@/lib/idp';

export const dynamic = 'force-dynamic';

export async function GET() {
  const jwks = getMockIdpJwks();
  return NextResponse.json(jwks, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/json'
    }
  });
}
