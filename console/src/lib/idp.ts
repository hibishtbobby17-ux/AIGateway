import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// In-memory or generated RSA keypair for Mock IdP
let privateKeyPem: string;
let publicKeyPem: string;
let jwkPublicKey: any;
const KEY_ID = 'mock-idp-key-1';

function initializeKeys() {
  if (privateKeyPem && publicKeyPem) return;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  privateKeyPem = privateKey;
  publicKeyPem = publicKey;

  // Export JWK public key
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' });
  jwkPublicKey = {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid: KEY_ID,
    n: jwk.n,
    e: jwk.e
  };
}

export function getMockIdpJwks() {
  initializeKeys();
  return {
    keys: [jwkPublicKey]
  };
}

export function getMockIdpIssuer(): string {
  // Support both host environments
  return process.env.IDP_ISSUER || 'http://console:3000/api/mock/idp';
}

export function signMockIdpToken(claims: {
  sub: string;
  aud?: string;
  scope?: string;
  client_id?: string;
  expiresIn?: number;
}): { access_token: string; expires_in: number } {
  initializeKeys();
  const issuer = getMockIdpIssuer();
  const expiresIn = claims.expiresIn || 3600;

  const payload = {
    iss: issuer,
    sub: claims.sub,
    aud: claims.aud || 'https://aigateway.local',
    client_id: claims.client_id || claims.sub,
    scope: claims.scope || 'mcp:tools mcp:read mcp:write',
  };

  const token = jwt.sign(payload, privateKeyPem, {
    algorithm: 'RS256',
    keyid: KEY_ID,
    expiresIn
  });

  return {
    access_token: token,
    expires_in: expiresIn
  };
}

export function verifyMockIdpToken(token: string, options?: { audience?: string; issuer?: string }) {
  initializeKeys();
  return jwt.verify(token, publicKeyPem, {
    algorithms: ['RS256'],
    audience: options?.audience,
    issuer: options?.issuer || getMockIdpIssuer()
  });
}

// In-memory code and refresh token stores for mock IdP
interface AuthCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  expiresAt: number;
}

interface RefreshTokenRecord {
  refreshToken: string;
  clientId: string;
  subject: string;
  scope: string;
  revoked: boolean;
}

const authCodes = new Map<string, AuthCodeRecord>();
const refreshTokens = new Map<string, RefreshTokenRecord>();

export function storeAuthCode(record: AuthCodeRecord) {
  authCodes.set(record.code, record);
}

export function exchangeAuthCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): { access_token: string; refresh_token: string; expires_in: number } | { error: string } {
  const record = authCodes.get(params.code);
  if (!record) {
    return { error: 'invalid_grant' };
  }
  if (Date.now() > record.expiresAt) {
    authCodes.delete(params.code);
    return { error: 'invalid_grant: code expired' };
  }
  if (record.clientId !== params.clientId) {
    return { error: 'invalid_client' };
  }

  // Verify PKCE S256 or plain
  if (record.codeChallengeMethod === 'S256') {
    const hash = crypto.createHash('sha256').update(params.codeVerifier).digest('base64url');
    if (hash !== record.codeChallenge) {
      return { error: 'invalid_grant: PKCE verification failed' };
    }
  } else if (record.codeChallenge !== params.codeVerifier) {
    return { error: 'invalid_grant: PKCE plain mismatch' };
  }

  authCodes.delete(params.code);

  // Generate tokens
  const tokenData = signMockIdpToken({
    sub: `user-${record.clientId}`,
    client_id: record.clientId,
    scope: record.scope
  });

  const refreshToken = `mock-rt-${crypto.randomBytes(24).toString('hex')}`;
  refreshTokens.set(refreshToken, {
    refreshToken,
    clientId: record.clientId,
    subject: `user-${record.clientId}`,
    scope: record.scope,
    revoked: false
  });

  return {
    access_token: tokenData.access_token,
    refresh_token: refreshToken,
    expires_in: tokenData.expires_in
  };
}

export function exchangeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): { access_token: string; expires_in: number } | { error: string } {
  const record = refreshTokens.get(params.refreshToken);
  if (!record || record.revoked) {
    return { error: 'invalid_grant: refresh token invalid or revoked' };
  }

  const tokenData = signMockIdpToken({
    sub: record.subject,
    client_id: record.clientId,
    scope: record.scope
  });

  return tokenData;
}

export function revokeRefreshToken(refreshToken: string) {
  if (refreshToken === 'all') {
    refreshTokens.forEach((r) => {
      r.revoked = true;
    });
    return;
  }
  const record = refreshTokens.get(refreshToken);
  if (record) {
    record.revoked = true;
  }
}
