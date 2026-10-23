import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import jwt from 'jsonwebtoken';

import { decryptSecret } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'dev-console-secret-super-secure-key-32bytes-min';

function verifyGatewayToken(req: NextRequest): { gatewayId: string; gatewayName: string } | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload?.type !== 'gateway') return null;
    return { gatewayId: payload.gatewayId, gatewayName: payload.gatewayName };
  } catch {
    return null;
  }
}

async function fetchLatestConfig(gatewayId?: string) {
  await initDatabase();

  // 1. Check if this gateway has specific project bindings configured
  let projQuery = `
    SELECT id, name, slug, status, settings, config_version
    FROM projects
    WHERE status = 'active'
    ORDER BY created_at ASC
  `;
  const queryParams: any[] = [];

  if (gatewayId) {
    const bindingCheck = await pool.query(
      'SELECT 1 FROM gateway_project_bindings WHERE gateway_id = $1 LIMIT 1',
      [gatewayId]
    );
    if (bindingCheck.rows.length > 0) {
      // Gateway has targeted project bindings: only push specific projects & rules
      projQuery = `
        SELECT p.id, p.name, p.slug, p.status, p.settings, p.config_version
        FROM projects p
        JOIN gateway_project_bindings gpb ON gpb.project_id = p.id
        WHERE p.status = 'active' AND gpb.gateway_id = $1
        ORDER BY p.created_at ASC
      `;
      queryParams.push(gatewayId);
    }
  }

  // 2. Fetch filtered projects
  const projRes = await pool.query(projQuery, queryParams);

  // 3. Compute max config version among targeted projects
  let maxVersion = 1;
  if (projRes.rows.length > 0) {
    for (const p of projRes.rows) {
      if (p.config_version > maxVersion) {
        maxVersion = p.config_version;
      }
    }
  }

  // 3. Fetch all servers with their tool policies and oauth configs
  const serversRes = await pool.query(`
    SELECT 
      s.id,
      s.project_id,
      s.name,
      s.namespace_prefix,
      s.transport,
      s.url,
      s.auth_type,
      s.timeouts,
      s.enabled,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'tool_name', tp.tool_name,
            'enabled', tp.enabled,
            'rename', tp.rename
          )
        ) FILTER (WHERE tp.id IS NOT NULL),
        '[]'
      ) as tool_policies,
      CASE WHEN oc.id IS NOT NULL THEN
        json_build_object(
          'issuer', oc.issuer,
          'token_endpoint', oc.token_endpoint,
          'client_id', oc.client_id,
          'client_secret_encrypted', oc.client_secret_encrypted,
          'scopes', oc.scopes,
          'audience', oc.audience,
          'grant_type', oc.grant_type,
          'status', COALESCE(ot.status, 'none')
        )
      ELSE NULL END as oauth_config
    FROM mcp_servers s
    LEFT JOIN tool_policies tp ON tp.mcp_server_id = s.id
    LEFT JOIN oauth_configs oc ON oc.mcp_server_id = s.id
    LEFT JOIN oauth_tokens ot ON ot.mcp_server_id = s.id
    WHERE s.enabled = true
    GROUP BY s.id, oc.id, ot.id
  `);

  const serversByProject: Record<string, any[]> = {};
  for (const s of serversRes.rows) {
    if (!serversByProject[s.project_id]) {
      serversByProject[s.project_id] = [];
    }

    let oauthConfig: any = null;
    if (s.oauth_config) {
      let clientSecret: string | undefined;
      if (s.oauth_config.client_secret_encrypted) {
        try {
          clientSecret = decryptSecret(s.oauth_config.client_secret_encrypted);
        } catch {
          // ignore
        }
      }
      oauthConfig = {
        issuer: s.oauth_config.issuer,
        token_endpoint: s.oauth_config.token_endpoint,
        client_id: s.oauth_config.client_id,
        client_secret: clientSecret,
        scopes: s.oauth_config.scopes || [],
        audience: s.oauth_config.audience,
        grant_type: s.oauth_config.grant_type,
        status: s.oauth_config.status || 'none',
      };
    }

    serversByProject[s.project_id].push({
      id: s.id,
      name: s.name,
      namespace_prefix: s.namespace_prefix,
      transport: s.transport,
      url: s.url,
      auth_type: s.auth_type,
      timeouts: s.timeouts,
      enabled: s.enabled,
      tool_policies: s.tool_policies || [],
      oauth_config: oauthConfig,
    });
  }

  const projectsMap: Record<string, any> = {};
  for (const p of projRes.rows) {
    const inboundAuth = p.settings?.inbound_auth || { mode: 'none' };
    projectsMap[p.slug] = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      settings: p.settings || {},
      inbound_auth: inboundAuth,
      config_version: p.config_version,
      servers: serversByProject[p.id] || [],
    };
  }

  return {
    config_version: maxVersion,
    generated_at: new Date().toISOString(),
    projects: projectsMap,
  };
}

export async function GET(req: NextRequest) {
  try {
    const gw = verifyGatewayToken(req);
    if (!gw) {
      return NextResponse.json({ error: 'Unauthorized gateway' }, { status: 401 });
    }

    const sinceParam = req.nextUrl.searchParams.get('since');
    const sinceVersion = sinceParam ? parseInt(sinceParam, 10) : -1;
    const ifNoneMatch = req.headers.get('if-none-match');

    const maxVerRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
    const currentMaxVersion = parseInt(maxVerRes.rows[0].max_version, 10);

    // If client is already on current max version, support long poll check
    if (sinceVersion >= currentMaxVersion || ifNoneMatch === `"v${currentMaxVersion}"`) {
      const waitTimeoutMs = 3000; // 3 seconds long-poll in serverless/docker environment
      const pollIntervalMs = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < waitTimeoutMs) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const checkRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
        const checkVersion = parseInt(checkRes.rows[0].max_version, 10);
        if (checkVersion > currentMaxVersion) {
          // Changed! Break and return new config
          break;
        }
      }

      // Re-check
      const finalRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
      const finalVersion = parseInt(finalRes.rows[0].max_version, 10);
      if (finalVersion <= sinceVersion) {
        return new NextResponse(null, {
          status: 304,
          headers: {
            'ETag': `"v${finalVersion}"`,
          },
        });
      }
    }

    const configPayload = await fetchLatestConfig(gw.gatewayId);
    return NextResponse.json(configPayload, {
      headers: {
        'ETag': `"v${configPayload.config_version}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('Config sync error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
