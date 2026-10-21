import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { encryptSecret } from '@/lib/crypto';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

function verifyAuth(req: NextRequest): { userId: string } | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDatabase();
  const serverId = params.id;

  const configRes = await pool.query(
    `SELECT id, project_id, mcp_server_id, issuer, token_endpoint, authorization_endpoint, jwks_uri, client_id, scopes, audience, redirect_uri, grant_type
     FROM oauth_configs
     WHERE mcp_server_id = $1`,
    [serverId]
  );

  const tokenRes = await pool.query(
    `SELECT status, expires_at, updated_at
     FROM oauth_tokens
     WHERE mcp_server_id = $1`,
    [serverId]
  );

  const status = tokenRes.rows.length > 0 ? tokenRes.rows[0].status : 'none';

  if (configRes.rows.length === 0) {
    return NextResponse.json({
      config: null,
      status: 'none'
    });
  }

  return NextResponse.json({
    config: configRes.rows[0],
    status,
    token_info: tokenRes.rows[0] || null
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDatabase();
  const serverId = params.id;
  const body = await req.json();

  const {
    issuer,
    token_endpoint,
    authorization_endpoint,
    jwks_uri,
    client_id,
    client_secret,
    scopes = [],
    audience,
    redirect_uri,
    grant_type = 'client_credentials'
  } = body;

  if (!issuer || !client_id) {
    return NextResponse.json({ error: 'issuer and client_id are required' }, { status: 400 });
  }

  // Find project_id for this server
  const srvRes = await pool.query(`SELECT project_id FROM mcp_servers WHERE id = $1`, [serverId]);
  if (srvRes.rows.length === 0) {
    return NextResponse.json({ error: 'MCP Server not found' }, { status: 404 });
  }
  const projectId = srvRes.rows[0].project_id;

  const encryptedSecret = client_secret ? encryptSecret(client_secret) : null;

  // Upsert oauth_configs
  await pool.query(
    `INSERT INTO oauth_configs (
       project_id, mcp_server_id, issuer, token_endpoint, authorization_endpoint, jwks_uri, client_id, client_secret_encrypted, scopes, audience, redirect_uri, grant_type, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
     )
     ON CONFLICT (mcp_server_id) DO UPDATE SET
       issuer = EXCLUDED.issuer,
       token_endpoint = EXCLUDED.token_endpoint,
       authorization_endpoint = EXCLUDED.authorization_endpoint,
       jwks_uri = EXCLUDED.jwks_uri,
       client_id = EXCLUDED.client_id,
       client_secret_encrypted = COALESCE(EXCLUDED.client_secret_encrypted, oauth_configs.client_secret_encrypted),
       scopes = EXCLUDED.scopes,
       audience = EXCLUDED.audience,
       redirect_uri = EXCLUDED.redirect_uri,
       grant_type = EXCLUDED.grant_type,
       updated_at = NOW()`,
    [
      projectId,
      serverId,
      issuer,
      token_endpoint,
      authorization_endpoint,
      jwks_uri,
      client_id,
      encryptedSecret,
      scopes,
      audience,
      redirect_uri,
      grant_type
    ]
  );

  // Update server auth_type
  const authType = grant_type === 'authorization_code' ? 'oauth_authcode' : 'oauth_cc';
  await pool.query(
    `UPDATE mcp_servers SET auth_type = $1, updated_at = NOW() WHERE id = $2`,
    [authType, serverId]
  );

  // Increment project config_version
  const updatedProjRes = await pool.query(
    `UPDATE projects
     SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW()
     WHERE id = $1
     RETURNING config_version`,
    [projectId]
  );

  return NextResponse.json({
    success: true,
    auth_type: authType,
    config_version: updatedProjRes.rows[0].config_version
  });
}
