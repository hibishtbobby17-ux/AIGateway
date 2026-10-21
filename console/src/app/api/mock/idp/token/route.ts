import { NextRequest, NextResponse } from 'next/server';
import { signMockIdpToken, exchangeAuthCode, exchangeRefreshToken } from '@/lib/idp';

export const dynamic = 'force-dynamic';

async function parseTokenParams(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') || '';
  const params: Record<string, string> = {};

  // Check HTTP Basic Auth (Authorization: Basic base64(client_id:client_secret))
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Basic ')) {
    const creds = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
    const [cId, cSec] = creds.split(':');
    if (cId) params.client_id = cId;
    if (cSec) params.client_secret = cSec;
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const parsed = new URLSearchParams(text);
    parsed.forEach((v, k) => {
      params[k] = v;
    });
  } else {
    try {
      const json = await req.json();
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string') {
          params[k] = v;
        }
      }
    } catch {
      // not JSON
    }
  }

  return params;
}

export async function POST(req: NextRequest) {
  try {
    const params = await parseTokenParams(req);
    const grantType = params.grant_type;

    if (!grantType) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'Missing grant_type parameter' },
        { status: 400 }
      );
    }

    // 1. Client Credentials Grant
    if (grantType === 'client_credentials') {
      const clientId = params.client_id || 'mock-client';
      const clientSecret = params.client_secret;

      if (!clientSecret) {
        return NextResponse.json(
          { error: 'invalid_client', error_description: 'Missing client_secret' },
          { status: 401 }
        );
      }

      const tokenData = signMockIdpToken({
        sub: `service-${clientId}`,
        client_id: clientId,
        scope: params.scope || 'mcp:tools mcp:read mcp:write',
        expiresIn: 3600
      });

      return NextResponse.json({
        access_token: tokenData.access_token,
        token_type: 'Bearer',
        expires_in: tokenData.expires_in,
        scope: params.scope || 'mcp:tools mcp:read mcp:write'
      });
    }

    // 2. Authorization Code Grant (with PKCE)
    if (grantType === 'authorization_code') {
      const code = params.code;
      const clientId = params.client_id;
      const redirectUri = params.redirect_uri;
      const codeVerifier = params.code_verifier;

      if (!code || !clientId || !redirectUri || !codeVerifier) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Missing code, client_id, redirect_uri, or code_verifier' },
          { status: 400 }
        );
      }

      const result = exchangeAuthCode({
        code,
        clientId,
        redirectUri,
        codeVerifier
      });

      if ('error' in result) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        token_type: 'Bearer',
        expires_in: result.expires_in
      });
    }

    // 3. Refresh Token Grant
    if (grantType === 'refresh_token') {
      const refreshToken = params.refresh_token;
      const clientId = params.client_id;

      if (!refreshToken || !clientId) {
        return NextResponse.json(
          { error: 'invalid_request', error_description: 'Missing refresh_token or client_id' },
          { status: 400 }
        );
      }

      const result = exchangeRefreshToken({
        refreshToken,
        clientId
      });

      if ('error' in result) {
        return NextResponse.json(
          { error: 'invalid_grant', error_description: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        access_token: result.access_token,
        token_type: 'Bearer',
        expires_in: result.expires_in
      });
    }

    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: `Grant type ${grantType} not supported` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: 'server_error', error_description: err.message },
      { status: 500 }
    );
  }
}
