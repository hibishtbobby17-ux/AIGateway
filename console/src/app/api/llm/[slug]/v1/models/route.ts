import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    await initDatabase();

    const gwRes = await pool.query(`
      SELECT * FROM llm_gateways
      WHERE slug = $1 AND status = 'active'
    `, [params.slug]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'LLM Gateway not found' }, { status: 404 });
    }

    const gateway = gwRes.rows[0];
    const primary = gateway.primary_backend || {};
    const fallbacks = gateway.fallback_backends || [];

    const modelsList = [
      {
        id: primary.model_alias || 'gpt-4o',
        object: 'model',
        created: 1715000000,
        owned_by: primary.provider || 'azure_openai',
        permission: [],
        root: primary.model_alias || 'gpt-4o',
        parent: null
      },
      ...fallbacks.map((fb: any) => ({
        id: fb.model_alias || 'claude-3-5-sonnet',
        object: 'model',
        created: 1715000000,
        owned_by: fb.provider || 'aws_bedrock',
        permission: [],
        root: fb.model_alias || 'claude-3-5-sonnet',
        parent: null
      }))
    ];

    return NextResponse.json({
      object: 'list',
      data: modelsList
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
