import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import {
  calculateCallCostUsd,
  resolveConsumerIdentity,
  resolveTaskMetadata,
  ModelRate,
} from '@/lib/finops';
import { evaluateInboundGuardrails, GuardrailsConfig } from '@/lib/guardrails';
import { dispatchToLLMProvider } from '@/lib/llm-providers';

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
    const {
      prompt = 'Hello from AI Console Test Playground',
      system_prompt = 'You are an enterprise AI assistant behind the AI Gateway.',
      simulate_fallback = false,
      target_provider_override = '',
      guardrails_override,
      auth_token = '',
      consumer_id = '',
      task_id = '',
      task_title = '',
      step_name = '',
      task_status = 'completed',
    } = body;

    const inboundMessages = [
      ...(system_prompt ? [{ role: 'system', content: system_prompt }] : []),
      { role: 'user', content: prompt },
    ];

    const effectiveGuardrails: GuardrailsConfig = {
      ...(gateway.guardrails || {}),
      ...(guardrails_override || {}),
    };

    const guardrailResult = evaluateInboundGuardrails(inboundMessages, 1000, effectiveGuardrails);

    const authMode = gateway.inbound_auth?.mode || 'api_key';
    const consumer = resolveConsumerIdentity(
      req,
      { ...body, consumer_id: consumer_id || 'playground-sandbox' },
      gateway,
      authMode,
      auth_token
    );
    const taskMeta = resolveTaskMetadata(
      req,
      { ...body, task_id, task_title, step_name, task_status },
      prompt
    );

    if (!guardrailResult.allowed) {
      await pool
        .query(
          `
          UPDATE llm_gateways
          SET metrics = jsonb_set(
            metrics,
            '{guardrail_blocks}',
            to_jsonb(COALESCE((metrics->>'guardrail_blocks')::bigint, 0) + 1)
          ),
          updated_at = NOW()
          WHERE id = $1
          `,
          [gateway.id]
        )
        .catch(() => {});

      return NextResponse.json({
        success: false,
        blocked_by_guardrail: true,
        error: guardrailResult.blocked_reason,
        result: {
          id: `chatcmpl-blocked-${Date.now().toString(36)}`,
          model: gateway.primary_backend?.model_alias || 'gpt-4o',
          provider: gateway.primary_backend?.provider || 'azure_openai',
          region: gateway.primary_backend?.region || 'eastus2',
          failover_triggered: false,
          latency_ms: Math.max(Date.now() - startTime, 18),
          response_text: `🛑 ${guardrailResult.blocked_reason}`,
          guardrails: guardrailResult,
          inbound_auth_verified: true,
          auth_mode: authMode,
          endpoint: `/api/llm/${gateway.slug}/v1/chat/completions`,
        },
      });
    }

    if (guardrailResult.redactions_count > 0) {
      await pool
        .query(
          `
          UPDATE llm_gateways
          SET metrics = jsonb_set(
            metrics,
            '{guardrail_redactions}',
            to_jsonb(COALESCE((metrics->>'guardrail_redactions')::bigint, 0) + $1::bigint)
          ),
          updated_at = NOW()
          WHERE id = $2
          `,
          [guardrailResult.redactions_count, gateway.id]
        )
        .catch(() => {});
    }

    const primary = gateway.primary_backend || { provider: 'azure_openai', model_alias: 'gpt-4o', region: 'eastus2' };
    const fallbacks = gateway.fallback_backends || [];

    let selectedBackend = primary;
    let failoverTriggered = false;

    if (target_provider_override) {
      const matchedFallback = fallbacks.find((fb: any) => fb.provider === target_provider_override);
      selectedBackend =
        primary.provider === target_provider_override
          ? primary
          : matchedFallback || {
              provider: target_provider_override,
              model_alias:
                target_provider_override === 'aws_bedrock'
                  ? 'claude-3-5-sonnet'
                  : target_provider_override === 'anthropic_direct'
                  ? 'claude-3.5-sonnet'
                  : target_provider_override === 'google_vertex'
                  ? 'gemini-1.5-pro'
                  : 'gpt-4o',
              region:
                target_provider_override === 'aws_bedrock'
                  ? 'us-east-1'
                  : target_provider_override === 'azure_openai'
                  ? 'eastus2'
                  : 'global',
            };
    } else if (simulate_fallback && fallbacks.length > 0) {
      selectedBackend = fallbacks[0];
      failoverTriggered = true;
    }

    const dispatchResult = await dispatchToLLMProvider(
      selectedBackend,
      guardrailResult.sanitized_messages,
      {
        temperature: 0.7,
        max_tokens: guardrailResult.effective_max_tokens,
        gatewayName: gateway.name,
      }
    );

    const latencyMs = Math.max(Date.now() - startTime, 140 + Math.floor(Math.random() * 90));
    const chosenProvider = dispatchResult.provider;
    const chosenModel = dispatchResult.model;
    const chosenRegion = dispatchResult.region;
    const promptTokens = dispatchResult.prompt_tokens;
    const completionTokens = dispatchResult.completion_tokens;
    const totalTokens = dispatchResult.total_tokens;

    const ratesRes = await pool
      .query(
        'SELECT provider, model, input_rate_per_1m, output_rate_per_1m FROM llm_model_rates WHERE org_id = $1',
        [session.orgId]
      )
      .catch(() => ({ rows: [] as ModelRate[] }));
    const customRates: ModelRate[] = ratesRes.rows || [];

    const costBreakdown = calculateCallCostUsd(
      chosenProvider,
      chosenModel,
      promptTokens,
      completionTokens,
      customRates
    );

    const primaryBaselineCost = failoverTriggered
      ? calculateCallCostUsd(
          primary.provider || 'azure_openai',
          primary.model_alias || 'gpt-4o',
          promptTokens,
          completionTokens,
          customRates
        ).cost_usd
      : costBreakdown.cost_usd;

    let stepNumber = 1;
    let taskCumulativeTokens = totalTokens;
    let taskCumulativeCostUsd = costBreakdown.cost_usd;

    try {
      const existingTaskRes = await pool.query(
        `
        SELECT
          COUNT(*)::int AS steps_count,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
          COALESCE(SUM(cost_usd), 0)::float8 AS total_cost_usd,
          MAX(task_title) AS existing_title
        FROM llm_usage_ledger
        WHERE org_id = $1 AND task_id = $2
        `,
        [session.orgId, taskMeta.task_id]
      );

      stepNumber = (existingTaskRes.rows[0]?.steps_count || 0) + 1;
      const effectiveTitle = existingTaskRes.rows[0]?.existing_title || taskMeta.task_title;

      await pool.query(
        `
        INSERT INTO llm_usage_ledger (
          org_id, gateway_id, gateway_slug, consumer_id, consumer_name, auth_mode,
          task_id, task_title, step_number, step_name, task_status,
          provider, model, region, failover_triggered,
          prompt_tokens, completion_tokens, total_tokens,
          cost_usd, prompt_cost_usd, completion_cost_usd, primary_baseline_cost_usd, latency_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `,
        [
          session.orgId,
          gateway.id,
          gateway.slug,
          consumer.consumer_id,
          consumer.consumer_name,
          authMode,
          taskMeta.task_id,
          effectiveTitle,
          stepNumber,
          taskMeta.step_name === 'LLM Completion Call' ? `Step ${stepNumber}: Playground Execution` : taskMeta.step_name,
          taskMeta.task_status,
          chosenProvider,
          chosenModel,
          chosenRegion,
          failoverTriggered,
          promptTokens,
          completionTokens,
          totalTokens,
          costBreakdown.cost_usd,
          costBreakdown.prompt_cost_usd,
          costBreakdown.completion_cost_usd,
          primaryBaselineCost,
          latencyMs,
        ]
      );

      taskCumulativeTokens = (existingTaskRes.rows[0]?.total_tokens || 0) + totalTokens;
      taskCumulativeCostUsd = Number(
        ((existingTaskRes.rows[0]?.total_cost_usd || 0) + costBreakdown.cost_usd).toFixed(6)
      );

      await pool.query(
        `
        UPDATE llm_gateways
        SET metrics = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                metrics,
                '{tokens_processed}',
                to_jsonb(COALESCE((metrics->>'tokens_processed')::bigint, 0) + $1::bigint)
              ),
              '{requests_total}',
              to_jsonb(COALESCE((metrics->>'requests_total')::bigint, 0) + 1)
            ),
            '{prompt_tokens}',
            to_jsonb(COALESCE((metrics->>'prompt_tokens')::bigint, 0) + $2::bigint)
          ),
          '{completion_tokens}',
          to_jsonb(COALESCE((metrics->>'completion_tokens')::bigint, 0) + $3::bigint)
        ),
        updated_at = NOW()
        WHERE id = $4
        `,
        [totalTokens, promptTokens, completionTokens, gateway.id]
      );
    } catch (err) {
      console.error('Failed to log playground FinOps usage:', err);
    }

    return NextResponse.json({
      success: true,
      result: {
        id: `chatcmpl-test-${Date.now().toString(36)}`,
        model: chosenModel,
        provider: chosenProvider,
        region: chosenRegion,
        failover_triggered: failoverTriggered,
        latency_ms: latencyMs,
        response_text: dispatchResult.assistant_content,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
        guardrails: guardrailResult,
        protocol_translation: {
          provider: dispatchResult.provider,
          protocol_family: dispatchResult.wire_spec.protocol_family,
          execution_mode: dispatchResult.execution_mode,
          target_url: dispatchResult.wire_spec.url,
          auth_scheme: dispatchResult.wire_spec.auth_scheme,
          redacted_headers: dispatchResult.wire_spec.redacted_headers,
          native_request_body: dispatchResult.wire_spec.native_request_body,
          native_response_preview: dispatchResult.native_response_preview,
        },
        finops: {
          consumer_id: consumer.consumer_id,
          consumer_name: consumer.consumer_name,
          task_id: taskMeta.task_id,
          step_number: stepNumber,
          call_cost_usd: costBreakdown.cost_usd,
          task_cumulative_tokens: taskCumulativeTokens,
          task_cumulative_cost_usd: taskCumulativeCostUsd,
          input_rate_per_1m: costBreakdown.input_rate_per_1m,
          output_rate_per_1m: costBreakdown.output_rate_per_1m,
        },
        inbound_auth_verified: true,
        auth_mode: authMode,
        endpoint: `/api/llm/${gateway.slug}/v1/chat/completions`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Playground execution error' }, { status: 500 });
  }
}
