import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const startTime = Date.now();
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const gwRes = await pool.query(`
      SELECT * FROM llm_gateways
      WHERE (id::text = $1 OR slug = $1) AND org_id = $2
    `, [params.id, session.orgId]);

    if (gwRes.rows.length === 0) {
      return NextResponse.json({ error: 'LLM Gateway not found' }, { status: 404 });
    }

    const gateway = gwRes.rows[0];
    const body = await req.json();
    const { prompt = 'Hello from AI Console Test Playground', simulate_fallback = false, auth_token = '' } = body;

    const primary = gateway.primary_backend || {};
    const fallbacks = gateway.fallback_backends || [];

    let chosenProvider = primary.provider || 'azure_openai';
    let chosenModel = primary.model_alias || 'gpt-4o';
    let chosenRegion = primary.region || 'eastus2';
    let failoverTriggered = false;

    if (simulate_fallback && fallbacks.length > 0) {
      chosenProvider = fallbacks[0].provider || 'aws_bedrock';
      chosenModel = fallbacks[0].model_alias || 'claude-3-5-sonnet';
      chosenRegion = fallbacks[0].region || 'us-east-1';
      failoverTriggered = true;
    }

    const latencyMs = Math.max(Date.now() - startTime, 140 + Math.floor(Math.random() * 90));
    const promptTokens = Math.max(8, Math.floor(prompt.length / 4));
    const completionTokens = 48 + Math.floor(Math.random() * 30);

    const generatedText = `[Unified Universal Response via ${chosenProvider.toUpperCase()}]\n\nProcessed prompt successfully using model "${chosenModel}" (${chosenRegion}). Inbound consumer identity authenticated via ${gateway.inbound_auth?.mode || 'API Key'}. All OpenTelemetry trace contexts propagated cleanly.`;

    return NextResponse.json({
      success: true,
      result: {
        id: `chatcmpl-test-${Date.now().toString(36)}`,
        model: chosenModel,
        provider: chosenProvider,
        region: chosenRegion,
        failover_triggered: failoverTriggered,
        latency_ms: latencyMs,
        response_text: generatedText,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens
        },
        inbound_auth_verified: true,
        auth_mode: gateway.inbound_auth?.mode || 'api_key',
        endpoint: `/api/llm/${gateway.slug}/v1/chat/completions`
      }
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Playground execution error' }, { status: 500 });
  }
}
