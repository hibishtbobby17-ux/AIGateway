import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const result = await pool.query(`
      SELECT * FROM llm_gateways
      WHERE (id::text = $1 OR slug = $1) AND org_id = $2
    `, [params.id, session.orgId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'LLM Gateway not found' }, { status: 404 });
    }

    return NextResponse.json({ gateway: result.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch LLM gateway' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const body = await req.json();
    const {
      name,
      status,
      inbound_auth,
      primary_backend,
      fallback_backends,
      routing_strategy,
      guardrails
    } = body;

    const result = await pool.query(`
      UPDATE llm_gateways
      SET 
        name = COALESCE($1, name),
        status = COALESCE($2, status),
        inbound_auth = COALESCE($3, inbound_auth),
        primary_backend = COALESCE($4, primary_backend),
        fallback_backends = COALESCE($5, fallback_backends),
        routing_strategy = COALESCE($6, routing_strategy),
        guardrails = COALESCE($7, guardrails),
        updated_at = NOW()
      WHERE (id::text = $8 OR slug = $8) AND org_id = $9
      RETURNING *
    `, [
      name ? name.trim() : null,
      status || null,
      inbound_auth ? JSON.stringify(inbound_auth) : null,
      primary_backend ? JSON.stringify(primary_backend) : null,
      fallback_backends ? JSON.stringify(fallback_backends) : null,
      routing_strategy || null,
      guardrails ? JSON.stringify(guardrails) : null,
      params.id,
      session.orgId
    ]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'LLM Gateway not found' }, { status: 404 });
    }

    return NextResponse.json({ gateway: result.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update LLM gateway' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const result = await pool.query(`
      DELETE FROM llm_gateways
      WHERE (id::text = $1 OR slug = $1) AND org_id = $2
      RETURNING id, name
    `, [params.id, session.orgId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'LLM Gateway not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: result.rows[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to delete LLM gateway' }, { status: 500 });
  }
}
