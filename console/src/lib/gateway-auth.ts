import { NextRequest } from 'next/server';
import { pool, initDatabase } from '@/db';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

export interface AuthenticatedGateway {
  gatewayId: string;
  gatewayName: string;
}

export async function authenticateGatewayRequest(req: NextRequest): Promise<AuthenticatedGateway | null> {
  let token = '';
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else {
    // Check URL query param as fallback (e.g. EventSource / SSE connections)
    const url = new URL(req.url);
    token = url.searchParams.get('token') || '';
  }

  if (!token) {
    return null;
  }

  const explicitGwId = req.headers.get('x-gateway-id') || new URL(req.url).searchParams.get('gateway_id') || '';

  // 1. Try JWT verification first
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload?.type === 'gateway' && payload.gatewayId) {
      return {
        gatewayId: payload.gatewayId,
        gatewayName: payload.gatewayName || 'Gateway',
      };
    }
  } catch {
    // Not a valid JWT, proceed to check direct gateway key (aigw_live_... or gwsec_...)
  }

  // 2. Direct Gateway Key Verification against database
  await initDatabase();

  if (explicitGwId) {
    const gwRes = await pool.query(`
      SELECT id, name, secret_hash, status, revoked_at
      FROM gateway_instances
      WHERE (id::text = $1 OR name = $1)
    `, [explicitGwId]);

    if (gwRes.rows.length > 0) {
      const gw = gwRes.rows[0];
      if (gw.status !== 'revoked' && !gw.revoked_at) {
        const match = await bcrypt.compare(token, gw.secret_hash);
        if (match) {
          return { gatewayId: gw.id, gatewayName: gw.name };
        }
      }
    }
  }

  // If no explicit ID or ID didn't match, search active gateways
  const allGateways = await pool.query(`
    SELECT id, name, secret_hash, status, revoked_at
    FROM gateway_instances
    WHERE status != 'revoked' AND revoked_at IS NULL
    ORDER BY last_seen_at DESC NULLS LAST
    LIMIT 20
  `);

  for (const gw of allGateways.rows) {
    const match = await bcrypt.compare(token, gw.secret_hash);
    if (match) {
      return { gatewayId: gw.id, gatewayName: gw.name };
    }
  }

  // 3. Fallback for default local dev secret
  if (token === 'dev-gateway-secret' || token === 'aigw_live_dev_test_secret_00000000000000') {
    const defaultGw = allGateways.rows[0];
    return {
      gatewayId: defaultGw ? defaultGw.id : '00000000-0000-0000-0000-000000000001',
      gatewayName: defaultGw ? defaultGw.name : 'Default Gateway',
    };
  }

  return null;
}
