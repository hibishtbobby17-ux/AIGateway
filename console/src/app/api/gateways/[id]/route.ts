import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT 
        id, 
        name, 
        last_seen_at, 
        version, 
        applied_config_version, 
        status, 
        COALESCE(protocol, 'http') as protocol,
        COALESCE(tls_enabled, false) as tls_enabled,
        COALESCE(metrics, '{}'::jsonb) as metrics,
        revoked_at, 
        created_at, 
        updated_at
      FROM gateway_instances
      WHERE id = $1
    `, [params.id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    const gw = gwRes.rows[0];
    const now = Date.now();
    const lastSeen = gw.last_seen_at ? new Date(gw.last_seen_at).getTime() : 0;
    const isOnline = gw.status === 'active' && (now - lastSeen < 180000);

    const scheme = (gw.protocol === 'https' || gw.tls_enabled) ? 'https' : 'http';
    const defaultPublicUrl = process.env.GATEWAY_PUBLIC_URL || 'http://localhost:8080';
    let baseUrl = defaultPublicUrl;
    try {
      const u = new URL(defaultPublicUrl);
      u.protocol = scheme;
      baseUrl = u.origin;
    } catch {
      baseUrl = `${scheme}://localhost:8080`;
    }

    // Check if this gateway has targeted project bindings
    const bindingsRes = await pool.query(
      'SELECT project_id FROM gateway_project_bindings WHERE gateway_id = $1',
      [params.id]
    );

    const isTargeted = bindingsRes.rows.length > 0;
    const mode = isTargeted ? 'targeted' : 'global';

    // Fetch projects served by this gateway
    let projQuery = `
      SELECT id, name, slug, status, settings, config_version, created_at
      FROM projects
      WHERE status = 'active'
    `;
    const queryParams: any[] = [];
    if (isTargeted) {
      projQuery += ` AND id = ANY($1::uuid[])`;
      queryParams.push(bindingsRes.rows.map((r: any) => r.project_id));
    }
    projQuery += ` ORDER BY created_at ASC`;
    const projRes = await pool.query(projQuery, queryParams);

    // Fetch all upstream MCP servers for these projects
    const projectIds = projRes.rows.map((p: any) => p.id);
    const serversByProject: Record<string, any[]> = {};
    if (projectIds.length > 0) {
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
          s.health_status,
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
              'scopes', oc.scopes,
              'grant_type', oc.grant_type
            )
          ELSE NULL END as oauth_config
        FROM mcp_servers s
        LEFT JOIN tool_policies tp ON tp.mcp_server_id = s.id
        LEFT JOIN oauth_configs oc ON oc.mcp_server_id = s.id
        WHERE s.project_id = ANY($1::uuid[])
        GROUP BY s.id, oc.id
        ORDER BY s.created_at ASC
      `, [projectIds]);

      for (const s of serversRes.rows) {
        if (!serversByProject[s.project_id]) {
          serversByProject[s.project_id] = [];
        }
        const isServerHttps = (s.url || '').toLowerCase().startsWith('https://');
        serversByProject[s.project_id].push({
          id: s.id,
          name: s.name,
          namespace_prefix: s.namespace_prefix,
          transport: s.transport || 'http',
          url: s.url,
          protocol: isServerHttps ? 'https' : 'http',
          tls_enabled: isServerHttps,
          auth_type: s.auth_type,
          enabled: s.enabled,
          health_status: s.health_status || 'healthy',
          timeouts: s.timeouts || { dial_ms: 5000, call_ms: 15000 },
          tool_policies: s.tool_policies || [],
          oauth_config: s.oauth_config,
        });
      }
    }

    // Format endpoints
    const endpoints = projRes.rows.map((p: any) => {
      const settings = p.settings || {};
      const inboundAuth = settings.inbound_auth || {
        mode: 'none',
        required_scopes: ['mcp:tools', 'mcp:read'],
      };
      const rateLimits = settings.rate_limits || {
        requests_per_minute: 600,
        burst: 50,
      };
      const circuitBreaker = settings.circuit_breaker || {
        max_failures: 5,
        recovery_seconds: 30,
      };
      const downstreamServers = serversByProject[p.id] || [];

      return {
        project_id: p.id,
        project_name: p.name,
        slug: p.slug,
        endpoint_path: `/p/${p.slug}/mcp`,
        endpoint_url: `${baseUrl}/p/${p.slug}/mcp`,
        oauth_discovery_url: `${baseUrl}/p/${p.slug}/.well-known/oauth-protected-resource`,
        status: p.status,
        config_version: p.config_version,
        created_at: p.created_at,
        inbound_auth: inboundAuth,
        rate_limits: rateLimits,
        circuit_breaker: circuitBreaker,
        downstream_servers: downstreamServers,
      };
    });

    const maxVerRes = await pool.query('SELECT COALESCE(MAX(config_version), 1) as max_version FROM projects');
    const targetConfigVersion = parseInt(maxVerRes.rows[0].max_version, 10);

    const tlsTelemetry = gw.metrics?.tls_telemetry || {
      inbound: {
        enabled: gw.tls_enabled || false,
        min_version: gw.tls_enabled ? 'TLS 1.3' : 'TLS 1.2',
        cert_mode: gw.tls_enabled ? 'auto_cert' : 'none',
        sans: ['localhost', '127.0.0.1', '::1', 'ai-gateway'],
        client_auth: 'none',
        has_client_ca: false,
      },
      downstream: {
        insecure_skip_verify: false,
        has_custom_ca: false,
        has_client_cert: false,
        min_version: 'TLS 1.2',
      },
    };

    return NextResponse.json({
      gateway: {
        ...gw,
        is_online: isOnline,
        base_url: baseUrl,
        mode: mode,
        target_config_version: targetConfigVersion,
        tls_telemetry: tlsTelemetry,
        total_endpoints: endpoints.length,
      },
      endpoints: endpoints,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT id, name FROM gateway_instances WHERE id = $1
    `, [params.id]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'Gateway instance not found' }, { status: 404 });
    }

    const gateway = gwRes.rows[0];

    await pool.query('DELETE FROM gateway_instances WHERE id = $1', [params.id]);

    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'gateway.delete',
      target: `gateway:${gateway.name} (${gateway.id})`,
    });

    return NextResponse.json({ success: true, message: 'Gateway instance deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
