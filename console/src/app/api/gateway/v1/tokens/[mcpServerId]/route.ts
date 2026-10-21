import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

function verifyGatewayToken(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return payload?.type === 'gateway';
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest, { params }: { params: { mcpServerId: string } }) {
  if (!verifyGatewayToken(req)) {
    return NextResponse.json({ error: 'Unauthorized gateway' }, { status: 401 });
  }

  await initDatabase();
  const serverId = params.mcpServerId;
  const forceRefresh = req.nextUrl.searchParams.get('force') === 'true';

  // Fetch token and config
  const tokenRes = await pool.query(
    `SELECT t.id, t.project_id, t.access_token_encrypted, t.refresh_token_encrypted, t.expires_at, t.status,
            c.token_endpoint, c.client_id, c.client_secret_encrypted
     FROM oauth_tokens t
     JOIN oauth_configs c ON c.mcp_server_id = t.mcp_server_id
     WHERE t.mcp_server_id = $1`,
    [serverId]
  );

  if (tokenRes.rows.length === 0) {
    return NextResponse.json({ error: 'reauth_required', message: 'No OAuth token found for server' }, { status: 401 });
  }

  const row = tokenRes.rows[0];
  if (row.status === 'reauth_required') {
    return NextResponse.json({ error: 'reauth_required', message: 'Downstream requires user re-authorization' }, { status: 401 });
  }

  const now = Date.now();
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const isExpiring = expiresAt - now < 60 * 1000; // less than 60s remaining

  if (isExpiring || forceRefresh) {
    // Attempt proactive token refresh
    if (!row.refresh_token_encrypted) {
      await pool.query(`UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1`, [row.id]);
      return NextResponse.json({ error: 'reauth_required', message: 'No refresh token available' }, { status: 401 });
    }

    try {
      const refreshToken = decryptSecret(row.refresh_token_encrypted);
      const tokenEndpoint = row.token_endpoint;
      const clientId = row.client_id;
      let clientSecret: string | undefined;
      if (row.client_secret_encrypted) {
        clientSecret = decryptSecret(row.client_secret_encrypted);
      }

      const bodyParams = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId
      });
      if (clientSecret) {
        bodyParams.set('client_secret', clientSecret);
      }

      const idpRes = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: bodyParams.toString()
      });

      if (!idpRes.ok) {
        // Refresh token invalid or revoked! Mark reauth_required
        await pool.query(
          `UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        // Bump config_version so gateway knows downstream status changed
        await pool.query(
          `UPDATE projects
           SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW()
           WHERE id = $1`,
          [row.project_id]
        );
        return NextResponse.json({ error: 'reauth_required', message: 'Refresh token rejected by IdP' }, { status: 401 });
      }

      const refreshed = await idpRes.json();
      const newAccess = refreshed.access_token;
      const newRefresh = refreshed.refresh_token || refreshToken;
      const expiresIn = refreshed.expires_in || 3600;
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

      const encAccess = encryptSecret(newAccess);
      const encRefresh = encryptSecret(newRefresh);

      await pool.query(
        `UPDATE oauth_tokens
         SET access_token_encrypted = $1,
             refresh_token_encrypted = $2,
             expires_at = $3,
             status = 'ok',
             updated_at = NOW()
         WHERE id = $4`,
        [encAccess, encRefresh, newExpiresAt, row.id]
      );

      return NextResponse.json({
        access_token: newAccess,
        token_type: 'Bearer',
        expires_in: expiresIn
      });
    } catch (err: any) {
      await pool.query(`UPDATE oauth_tokens SET status = 'reauth_required', updated_at = NOW() WHERE id = $1`, [row.id]);
      return NextResponse.json({ error: 'reauth_required', message: `Token refresh failed: ${err.message}` }, { status: 401 });
    }
  }

  // Token is still valid
  const currentAccess = decryptSecret(row.access_token_encrypted);
  const remainingSeconds = Math.max(1, Math.floor((expiresAt - now) / 1000));

  return NextResponse.json({
    access_token: currentAccess,
    token_type: 'Bearer',
    expires_in: remainingSeconds
  });
}
