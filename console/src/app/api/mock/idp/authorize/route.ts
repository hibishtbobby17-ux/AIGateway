import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { storeAuthCode } from '@/lib/idp';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const state = url.searchParams.get('state') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'plain';
  const scope = url.searchParams.get('scope') || 'mcp:tools';

  if (!clientId || !redirectUri || responseType !== 'code') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing client_id, redirect_uri, or response_type=code' },
      { status: 400 }
    );
  }

  // Generate authorization code (valid for 5 minutes)
  const code = `mock-code-${crypto.randomBytes(16).toString('hex')}`;
  storeAuthCode({
    code,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  // Construct redirect URL
  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (state) {
    target.searchParams.set('state', state);
  }

  return NextResponse.redirect(target.toString(), 302);
}
