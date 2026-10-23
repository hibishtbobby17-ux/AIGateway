import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const result = await pool.query(`
      SELECT 
        g.id,
        g.name,
        g.last_seen_at,
        g.version,
        g.applied_config_version,
        g.status,
        COALESCE(g.protocol, 'http') as protocol,
        COALESCE(g.tls_enabled, false) as tls_enabled,
        g.revoked_at,
        g.created_at,
        g.updated_at,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', p.id,
              'name', p.name,
              'slug', p.slug,
              'status', p.status,
              'endpoint_path', '/p/' || p.slug || '/mcp',
              'server_count', (SELECT COUNT(*)::int FROM mcp_servers s WHERE s.project_id = p.id AND s.enabled = true)
            )
          ) FILTER (WHERE p.id IS NOT NULL),
          '[]'
        ) as bound_projects
      FROM gateway_instances g
      LEFT JOIN gateway_project_bindings gpb ON gpb.gateway_id = g.id
      LEFT JOIN projects p ON p.id = gpb.project_id AND p.status = 'active'
      GROUP BY g.id
      ORDER BY g.created_at ASC
    `);

    // Decorate with live status & base URLs
    const now = Date.now();
    const defaultPublicUrl = process.env.GATEWAY_PUBLIC_URL || 'http://localhost:8080';

    const gatewaysWithDetails = result.rows.map((gw: any) => {
      const lastSeen = gw.last_seen_at ? new Date(gw.last_seen_at).getTime() : 0;
      const isOnline = gw.status === 'active' && (now - lastSeen < 180000); // within 3 minutes
      
      const scheme = (gw.protocol === 'https' || gw.tls_enabled) ? 'https' : 'http';
      let baseUrl = defaultPublicUrl;
      try {
        const u = new URL(defaultPublicUrl);
        u.protocol = scheme;
        baseUrl = u.origin;
      } catch {
        baseUrl = `${scheme}://localhost:8080`;
      }

      const enrichedProjects = (gw.bound_projects || []).map((bp: any) => ({
        ...bp,
        endpoint_url: `${baseUrl}${bp.endpoint_path}`,
      }));

      return {
        ...gw,
        protocol: scheme,
        is_online: isOnline,
        base_url: baseUrl,
        bound_projects: enrichedProjects,
        total_endpoints: enrichedProjects.length,
      };
    });

    return NextResponse.json({ gateways: gatewaysWithDetails });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Gateway name is required' }, { status: 400 });
    }

    await initDatabase();

    // Generate random secure secret
    const rawSecret = 'gwsec_' + crypto.randomBytes(24).toString('hex');
    const salt = await bcrypt.genSalt(10);
    const secretHash = await bcrypt.hash(rawSecret, salt);

    const insRes = await pool.query(`
      INSERT INTO gateway_instances (name, secret_hash, status, version)
      VALUES ($1, $2, 'registered', '1.0.0')
      RETURNING id, name, status, version, created_at
    `, [name.trim(), secretHash]);

    const createdGw = insRes.rows[0];

    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'gateway.create',
      target: `gateway:${createdGw.name} (${createdGw.id})`,
      diff: { name: createdGw.name, version: createdGw.version },
    });

    return NextResponse.json({
      gateway: createdGw,
      secret: rawSecret, // Return plaintext secret ONCE to operator
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
