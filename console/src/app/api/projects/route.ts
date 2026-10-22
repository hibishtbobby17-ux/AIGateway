import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

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
        p.id,
        p.org_id,
        p.name,
        p.slug,
        p.status,
        p.settings,
        p.config_version,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int as server_count
      FROM projects p
      LEFT JOIN mcp_servers s ON s.project_id = p.id
      WHERE p.org_id = $1
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `, [session.orgId]);

    return NextResponse.json({ projects: result.rows });
  } catch (err: any) {
    console.error('Failed to list projects:', err);
    return NextResponse.json({ error: err.message || 'Database query error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, slug, settings } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const cleanSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!cleanSlug) {
      return NextResponse.json({ error: 'Valid slug is required' }, { status: 400 });
    }

    await initDatabase();

    // Check slug collision
    const existing = await pool.query('SELECT id FROM projects WHERE slug = $1', [cleanSlug]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: `Project slug "${cleanSlug}" is already taken` }, { status: 409 });
    }

    const insRes = await pool.query(`
      INSERT INTO projects (org_id, name, slug, status, settings, config_version)
      VALUES ($1, $2, $3, 'active', $4, (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects))
      RETURNING id, org_id, name, slug, status, settings, config_version, created_at, updated_at
    `, [session.orgId, name.trim(), cleanSlug, JSON.stringify(settings || {})]);

    const createdProject = insRes.rows[0];

    const { logAudit } = await import('@/lib/audit');
    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'project.create',
      target: `project:${createdProject.slug} (${createdProject.id})`,
      diff: { name: createdProject.name, slug: createdProject.slug, status: createdProject.status },
    });

    return NextResponse.json({ project: createdProject }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create project:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
