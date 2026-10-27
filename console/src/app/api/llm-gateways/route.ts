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
        id, 
        name, 
        slug, 
        status, 
        inbound_auth, 
        primary_backend, 
        fallback_backends, 
        routing_strategy, 
        guardrails, 
        metrics, 
        created_at, 
        updated_at
      FROM llm_gateways
      WHERE org_id = $1
      ORDER BY created_at ASC
    `, [session.orgId]);

    return NextResponse.json({ gateways: result.rows });
  } catch (err: any) {
    console.error('Failed to list LLM gateways:', err);
    return NextResponse.json({ error: err.message || 'Failed to list LLM gateways' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const body = await req.json();
    const {
      name,
      slug,
      inbound_auth,
      primary_backend,
      fallback_backends = [],
      routing_strategy = 'priority_fallback',
      guardrails = {}
    } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 });
    }

    // Clean and validate slug
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
    if (!cleanSlug) {
      return NextResponse.json({ error: 'Invalid gateway slug' }, { status: 400 });
    }

    // Check slug collision
    const existing = await pool.query('SELECT id FROM llm_gateways WHERE slug = $1', [cleanSlug]);
    if (existing.rows.length > 0) {
      return NextResponse.json({ error: `An LLM Gateway with slug "${cleanSlug}" already exists` }, { status: 409 });
    }

    const defaultMetrics = {
      tokens_processed: 0,
      requests_total: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      fallback_events: 0,
      avg_latency_ms: 0,
    };

    const insertResult = await pool.query(`
      INSERT INTO llm_gateways (
        org_id, 
        name, 
        slug, 
        status, 
        inbound_auth, 
        primary_backend, 
        fallback_backends, 
        routing_strategy, 
        guardrails, 
        metrics
      )
      VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      session.orgId,
      name.trim(),
      cleanSlug,
      JSON.stringify(inbound_auth || { mode: 'api_key', allow_api_key: true }),
      JSON.stringify(primary_backend || {}),
      JSON.stringify(fallback_backends),
      routing_strategy,
      JSON.stringify(guardrails),
      JSON.stringify(defaultMetrics)
    ]);

    return NextResponse.json({ gateway: insertResult.rows[0] }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create LLM gateway:', err);
    return NextResponse.json({ error: err.message || 'Failed to create LLM gateway' }, { status: 500 });
  }
}
