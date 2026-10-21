import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { decryptSecret } from '@/lib/crypto';
import { createOAuthSession } from '@/lib/oauth-sessions';
import crypto from 'crypto';
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDatabase();
  const serverId = params.id;

  const cfgRes = await pool.query(
    `SELECT project_id, issuer, token_endpoint, authorization_endpoint, client_id, client_secret_encrypted, scopes, redirect_uri
     FROM oauth_configs
     WHERE mcp_server_id = $1`,
    [serverId]
  );

  if (cfgRes.rows.length === 0) {
    return NextResponse.json({ error: 'OAuth configuration not found for server' }, { status: 404 });
  }

  const cfg = cfgRes.rows[0];
  const authorizationEndpoint = cfg.authorization_endpoint || `${cfg.issuer}/authorize`;
  const tokenEndpoint = cfg.token_endpoint || `${cfg.issuer}/token`;

  let clientSecret: string | undefined;
  if (cfg.client_secret_encrypted) {
    try {
      clientSecret = decryptSecret(cfg.client_secret_encrypted);
    } catch {
      // ignore
    }
  }

  // Derive redirect URI
  const host = req.headers.get('host') || 'console:3000';
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const redirectUri = cfg.redirect_uri || `${proto}://${host}/api/oauth/callback`;

  // Generate PKCE code_verifier and code_challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  createOAuthSession({
    mcpServerId: serverId,
    projectId: cfg.project_id,
    state,
    codeVerifier,
    redirectUri,
    tokenEndpoint,
    clientId: cfg.client_id,
    clientSecret,
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  });

  const authUrl = new URL(authorizationEndpoint);
  authUrl.searchParams.set('client_id', cfg.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const scopes = Array.isArray(cfg.scopes) && cfg.scopes.length > 0 ? cfg.scopes.join(' ') : 'mcp:tools';
  authUrl.searchParams.set('scope', scopes);

  return NextResponse.json({
    authorization_url: authUrl.toString(),
    state,
    redirect_uri: redirectUri
  });
}
