import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import jwt from 'jsonwebtoken';

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

async function fetchLatestConfig() {
  await initDatabase();

  // 1. Get max config version across projects
  const maxVerRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
  const maxVersion = parseInt(maxVerRes.rows[0].max_version, 10);

  // 2. Fetch all active projects
  const projRes = await pool.query(`
    SELECT id, name, slug, status, settings, config_version
    FROM projects
    WHERE status = 'active'
    ORDER BY created_at ASC
  `);

  // 3. Fetch all servers with their tool policies
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
          json_build_object(
            'tool_name', tp.tool_name,
            'enabled', tp.enabled,
            'rename', tp.rename
          )
        ) FILTER (WHERE tp.id IS NOT NULL),
        '[]'
      ) as tool_policies
    FROM mcp_servers s
    LEFT JOIN tool_policies tp ON tp.mcp_server_id = s.id
    WHERE s.enabled = true
    GROUP BY s.id
  `);

  const serversByProject: Record<string, any[]> = {};
  for (const s of serversRes.rows) {
    if (!serversByProject[s.project_id]) {
      serversByProject[s.project_id] = [];
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
    });
  }

  const projectsMap: Record<string, any> = {};
  for (const p of projRes.rows) {
    projectsMap[p.slug] = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      status: p.status,
      settings: p.settings || {},
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

    const configPayload = await fetchLatestConfig();
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
