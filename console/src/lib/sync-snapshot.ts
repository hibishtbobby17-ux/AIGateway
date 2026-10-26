import { pool, initDatabase } from '@/db';
import { decryptSecret } from '@/lib/crypto';

export interface SyncSnapshotData {
  $schema: string;
  version: string;
  config_version: number;
  timestamp: string;
  routes: any[];
  providers: any[];
  guardrails: {
    blocked_regex_patterns: string[];
    max_input_tokens: number;
    pii_redaction: boolean;
  };
  projects: Record<string, any>;
  circuit_breaker_defaults: {
    failure_threshold_pct: number;
    recovery_time_sec: number;
    dial_timeout_ms: number;
    call_timeout_ms: number;
  };
}

export async function buildSyncSnapshot(gatewayId?: string): Promise<SyncSnapshotData> {
  await initDatabase();

  // 1. Query projects (checking for targeted gateway bindings if specified)
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

  const projRes = await pool.query(projQuery, queryParams);

  let maxVersion = 1;
  for (const p of projRes.rows) {
    if (p.config_version > maxVersion) {
      maxVersion = p.config_version;
    }
  }

  // 2. Fetch servers with tool policies and OAuth configurations
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
    GROUP BY s.id, oc.id, ot.status
    ORDER BY s.created_at ASC
  `);

  const serversByProject: Record<string, any[]> = {};
  const routesList: any[] = [];
  const providersList: any[] = [];

  for (const s of serversRes.rows) {
    if (!serversByProject[s.project_id]) {
      serversByProject[s.project_id] = [];
    }

    let oauthDecrypted = null;
    if (s.oauth_config) {
      oauthDecrypted = {
        ...s.oauth_config,
        client_secret: s.oauth_config.client_secret_encrypted
          ? decryptSecret(s.oauth_config.client_secret_encrypted)
          : '',
      };
      delete oauthDecrypted.client_secret_encrypted;
    }

    const serverObj = {
      id: s.id,
      name: s.name,
      namespace_prefix: s.namespace_prefix,
      transport: s.transport,
      url: s.url,
      auth_type: s.auth_type,
      timeouts: s.timeouts,
      enabled: s.enabled,
      tool_policies: s.tool_policies || [],
      oauth_config: oauthDecrypted,
    };

    serversByProject[s.project_id].push(serverObj);

    // Build providers list
    providersList.push({
      id: `mcp_${s.namespace_prefix}_${s.id.substring(0, 8)}`,
      provider: s.name,
      endpoint: s.url,
      transport: s.transport,
      auth_type: s.auth_type,
      rate_limits: {
        rpm: 600,
        burst: 50,
      },
    });
  }

  // 3. Assemble projects dictionary & routes
  const projectsMap: Record<string, any> = {};

  for (const p of projRes.rows) {
    const s = p.settings || {};
    const auth = s.inbound_auth || {};

    const inboundAuth = {
      mode: auth.mode || 'none',
      issuer: auth.issuer || '',
      jwks_uri: auth.jwks_uri || '',
      audience: auth.audience || '',
      required_scopes: auth.required_scopes || [],
    };

    projectsMap[p.slug] = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      config_version: p.config_version,
      settings: p.settings,
      inbound_auth: inboundAuth,
      servers: serversByProject[p.id] || [],
    };

    // Build route entries matching Section 4 schema
    routesList.push({
      id: `route_${p.slug}`,
      path_prefix: `/p/${p.slug}/mcp`,
      project_id: p.id,
      slug: p.slug,
      timeout_ms: s.circuit_breaker?.call_timeout_ms || 15000,
      retries: 2,
      circuit_breaker: {
        failure_threshold_pct: 50,
        recovery_time_sec: s.circuit_breaker?.recovery_seconds || 15,
      },
    });
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: `v${maxVersion}`,
    config_version: maxVersion,
    timestamp: new Date().toISOString(),
    routes: routesList,
    providers: providersList,
    guardrails: {
      blocked_regex_patterns: [
        '(?i)(api[_-]?key|bearer\\s+[a-z0-9_-]+)',
        '(?i)(password|secret)\\s*[:=]\\s*[\'"][^\'"]+[\'"]',
      ],
      max_input_tokens: 16384,
      pii_redaction: true,
    },
    projects: projectsMap,
    circuit_breaker_defaults: {
      failure_threshold_pct: 50,
      recovery_time_sec: 15,
      dial_timeout_ms: 5000,
      call_timeout_ms: 15000,
    },
  };
}
