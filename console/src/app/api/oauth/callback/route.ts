import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { encryptSecret } from '@/lib/crypto';
import { consumeOAuthSession } from '@/lib/oauth-sessions';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    return new NextResponse(
      `<html><body><h2>OAuth Authorization Error</h2><p>${error}: ${errorDescription || ''}</p></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  if (!code || !state) {
    return new NextResponse(
      `<html><body><h2>OAuth Callback Error</h2><p>Missing code or state parameter</p></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const session = consumeOAuthSession(state);
  if (!session) {
    return new NextResponse(
      `<html><body><h2>OAuth Callback Error</h2><p>Invalid or expired state session</p></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  try {
    // Exchange code + code_verifier at IdP token endpoint
    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: session.clientId,
      code,
      redirect_uri: session.redirectUri,
      code_verifier: session.codeVerifier
    });

    if (session.clientSecret) {
      bodyParams.set('client_secret', session.clientSecret);
    }

    const tokenRes = await fetch(session.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyParams.toString()
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new NextResponse(
        `<html><body><h2>Token Exchange Failed</h2><p>HTTP ${tokenRes.status}: ${errText}</p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const expiresIn = tokenData.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await initDatabase();

    const encryptedAccess = encryptSecret(accessToken);
    const encryptedRefresh = refreshToken ? encryptSecret(refreshToken) : null;

    // Upsert into oauth_tokens
    await pool.query(
      `INSERT INTO oauth_tokens (
         project_id, mcp_server_id, access_token_encrypted, refresh_token_encrypted, expires_at, status, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'ok', NOW()
       )
       ON CONFLICT (mcp_server_id) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, oauth_tokens.refresh_token_encrypted),
         expires_at = EXCLUDED.expires_at,
         status = 'ok',
         updated_at = NOW()`,
      [session.projectId, session.mcpServerId, encryptedAccess, encryptedRefresh, expiresAt]
    );

    // Bump project config_version
    await pool.query(
      `UPDATE projects
       SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW()
       WHERE id = $1`,
      [session.projectId]
    );

    // Also return JSON if Accept is application/json
    if (req.headers.get('accept')?.includes('application/json')) {
      return NextResponse.json({
        success: true,
        status: 'ok',
        expires_at: expiresAt.toISOString()
      });
    }

    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>OAuth Connected</title></head>
<body style="font-family: system-ui, sans-serif; background: #0a0a0c; color: #f0f0f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="background: rgba(255,255,255,0.05); padding: 32px 48px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); text-align: center;">
    <h2 style="color: #4ade80; margin-bottom: 8px;">✓ OAuth Connection Established</h2>
    <p style="color: #a1a1aa; font-size: 14px;">Authorized downstream MCP session. Refresh tokens securely vaulted in Control Plane.</p>
    <p style="color: #71717a; font-size: 12px; margin-top: 16px;">You may safely close this tab or return to the AI Console.</p>
  </div>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err: any) {
    return new NextResponse(
      `<html><body><h2>Callback Processing Error</h2><p>${err.message}</p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
