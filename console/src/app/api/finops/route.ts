import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { calculateCallCostUsd, ModelRate } from '@/lib/finops';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const { searchParams } = new URL(req.url);
    const gatewayFilter = searchParams.get('gateway') || '';
    const consumerFilter = searchParams.get('consumer') || '';

    // 1. Fetch Model Rates & Consumer Budgets
    const [ratesRes, budgetsRes, gatewaysRes] = await Promise.all([
      pool.query(
        'SELECT id, provider, model, input_rate_per_1m, output_rate_per_1m, updated_at FROM llm_model_rates WHERE org_id = $1 ORDER BY provider ASC, model ASC',
        [session.orgId]
      ),
      pool.query(
        'SELECT id, consumer_id, consumer_name, monthly_budget_usd, high_cost_task_threshold_usd, updated_at FROM llm_consumer_budgets WHERE org_id = $1 ORDER BY consumer_id ASC',
        [session.orgId]
      ),
      pool.query(
        'SELECT id, name, slug, primary_backend, fallback_backends FROM llm_gateways WHERE org_id = $1 ORDER BY created_at ASC',
        [session.orgId]
      ),
    ]);

    const budgetMap = new Map<string, { monthly_budget_usd: number; high_cost_task_threshold_usd: number; consumer_name: string }>();
    for (const b of budgetsRes.rows) {
      budgetMap.set(b.consumer_id, {
        monthly_budget_usd: Number(b.monthly_budget_usd),
        high_cost_task_threshold_usd: Number(b.high_cost_task_threshold_usd),
        consumer_name: b.consumer_name,
      });
    }

    // 2. Fetch Ledger Entries
    const params: any[] = [session.orgId];
    let filterSql = '';
    if (gatewayFilter) {
      params.push(gatewayFilter);
      filterSql += ` AND gateway_slug = $${params.length}`;
    }
    if (consumerFilter) {
      params.push(consumerFilter);
      filterSql += ` AND consumer_id = $${params.length}`;
    }

    const ledgerRes = await pool.query(
      `
      SELECT
        id,
        gateway_id,
        gateway_slug,
        consumer_id,
        consumer_name,
        auth_mode,
        task_id,
        task_title,
        step_number,
        step_name,
        task_status,
        provider,
        model,
        region,
        failover_triggered,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        cost_usd,
        prompt_cost_usd,
        completion_cost_usd,
        primary_baseline_cost_usd,
        latency_ms,
        created_at
      FROM llm_usage_ledger
      WHERE org_id = $1 ${filterSql}
      ORDER BY created_at DESC, step_number ASC
      `,
      params
    );

    const rows = ledgerRes.rows;

    // 3. Group by Task (task_id)
    interface TaskRollup {
      task_id: string;
      task_title: string;
      consumer_id: string;
      consumer_name: string;
      auth_mode: string;
      gateway_slug: string;
      task_status: string;
      steps_count: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      total_cost_usd: number;
      prompt_cost_usd: number;
      completion_cost_usd: number;
      primary_baseline_cost_usd: number;
      failover_cost_delta_usd: number;
      failover_steps: number;
      total_latency_ms: number;
      is_high_cost: boolean;
      high_cost_threshold_usd: number;
      started_at: string;
      completed_at: string;
      models_used: string[];
      providers_used: string[];
      steps: any[];
    }

    const taskMap = new Map<string, TaskRollup>();

    for (const r of rows) {
      const tid = r.task_id;
      const bConf = budgetMap.get(r.consumer_id);
      const highThreshold = bConf ? bConf.high_cost_task_threshold_usd : 0.045;

      if (!taskMap.has(tid)) {
        taskMap.set(tid, {
          task_id: tid,
          task_title: r.task_title || tid,
          consumer_id: r.consumer_id,
          consumer_name: bConf?.consumer_name || r.consumer_name || r.consumer_id,
          auth_mode: r.auth_mode || 'api_key',
          gateway_slug: r.gateway_slug,
          task_status: r.task_status || 'completed',
          steps_count: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          total_cost_usd: 0,
          prompt_cost_usd: 0,
          completion_cost_usd: 0,
          primary_baseline_cost_usd: 0,
          failover_cost_delta_usd: 0,
          failover_steps: 0,
          total_latency_ms: 0,
          is_high_cost: false,
          high_cost_threshold_usd: highThreshold,
          started_at: r.created_at,
          completed_at: r.created_at,
          models_used: [],
          providers_used: [],
          steps: [],
        });
      }

      const t = taskMap.get(tid)!;
      t.steps_count += 1;
      t.prompt_tokens += Number(r.prompt_tokens || 0);
      t.completion_tokens += Number(r.completion_tokens || 0);
      t.total_tokens += Number(r.total_tokens || 0);
      t.total_cost_usd = Number((t.total_cost_usd + Number(r.cost_usd || 0)).toFixed(6));
      t.prompt_cost_usd = Number((t.prompt_cost_usd + Number(r.prompt_cost_usd || 0)).toFixed(6));
      t.completion_cost_usd = Number((t.completion_cost_usd + Number(r.completion_cost_usd || 0)).toFixed(6));
      t.primary_baseline_cost_usd = Number(
        (t.primary_baseline_cost_usd + Number(r.primary_baseline_cost_usd || r.cost_usd || 0)).toFixed(6)
      );
      t.failover_cost_delta_usd = Number(
        (t.total_cost_usd - t.primary_baseline_cost_usd).toFixed(6)
      );
      if (r.failover_triggered) {
        t.failover_steps += 1;
      }
      t.total_latency_ms += Number(r.latency_ms || 0);

      if (!t.models_used.includes(r.model)) t.models_used.push(r.model);
      if (!t.providers_used.includes(r.provider)) t.providers_used.push(r.provider);

      if (new Date(r.created_at) < new Date(t.started_at)) t.started_at = r.created_at;
      if (new Date(r.created_at) > new Date(t.completed_at)) t.completed_at = r.created_at;

      t.steps.push({
        id: r.id,
        step_number: Number(r.step_number || 1),
        step_name: r.step_name,
        provider: r.provider,
        model: r.model,
        region: r.region,
        failover_triggered: Boolean(r.failover_triggered),
        prompt_tokens: Number(r.prompt_tokens || 0),
        completion_tokens: Number(r.completion_tokens || 0),
        total_tokens: Number(r.total_tokens || 0),
        cost_usd: Number(r.cost_usd || 0),
        prompt_cost_usd: Number(r.prompt_cost_usd || 0),
        completion_cost_usd: Number(r.completion_cost_usd || 0),
        primary_baseline_cost_usd: Number(r.primary_baseline_cost_usd || r.cost_usd || 0),
        latency_ms: Number(r.latency_ms || 0),
        created_at: r.created_at,
      });
    }

    const tasks = Array.from(taskMap.values()).map((t) => {
      t.steps.sort((a, b) => a.step_number - b.step_number);
      t.is_high_cost = t.total_cost_usd >= t.high_cost_threshold_usd;
      return t;
    });

    tasks.sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime());

    // 4. Group by Consumer (Chargeback Table)
    interface ConsumerRollup {
      consumer_id: string;
      consumer_name: string;
      auth_mode: string;
      gateways: string[];
      models: string[];
      total_tasks: number;
      tasks_completed: number;
      tasks_in_progress: number;
      tasks_failed: number;
      high_cost_tasks: number;
      total_steps: number;
      avg_steps_per_task: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      avg_tokens_per_task: number;
      prompt_cost_usd: number;
      completion_cost_usd: number;
      total_cost_usd: number;
      avg_cost_per_task_usd: number;
      max_task_cost_usd: number;
      failover_steps: number;
      failover_cost_delta_usd: number;
      monthly_budget_usd: number;
      budget_utilization_pct: number;
      high_cost_task_threshold_usd: number;
      last_active_at: string;
    }

    const consumerMap = new Map<string, ConsumerRollup>();

    for (const t of tasks) {
      const cid = t.consumer_id;
      const bConf = budgetMap.get(cid);
      const monthlyBudget = bConf ? bConf.monthly_budget_usd : 0.50;
      const highThreshold = bConf ? bConf.high_cost_task_threshold_usd : 0.045;

      if (!consumerMap.has(cid)) {
        consumerMap.set(cid, {
          consumer_id: cid,
          consumer_name: t.consumer_name,
          auth_mode: t.auth_mode,
          gateways: [],
          models: [],
          total_tasks: 0,
          tasks_completed: 0,
          tasks_in_progress: 0,
          tasks_failed: 0,
          high_cost_tasks: 0,
          total_steps: 0,
          avg_steps_per_task: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          avg_tokens_per_task: 0,
          prompt_cost_usd: 0,
          completion_cost_usd: 0,
          total_cost_usd: 0,
          avg_cost_per_task_usd: 0,
          max_task_cost_usd: 0,
          failover_steps: 0,
          failover_cost_delta_usd: 0,
          monthly_budget_usd: monthlyBudget,
          budget_utilization_pct: 0,
          high_cost_task_threshold_usd: highThreshold,
          last_active_at: t.completed_at,
        });
      }

      const c = consumerMap.get(cid)!;
      c.total_tasks += 1;
      if (t.task_status === 'completed') c.tasks_completed += 1;
      else if (t.task_status === 'in_progress') c.tasks_in_progress += 1;
      else c.tasks_failed += 1;

      if (t.is_high_cost) c.high_cost_tasks += 1;

      c.total_steps += t.steps_count;
      c.prompt_tokens += t.prompt_tokens;
      c.completion_tokens += t.completion_tokens;
      c.total_tokens += t.total_tokens;
      c.prompt_cost_usd = Number((c.prompt_cost_usd + t.prompt_cost_usd).toFixed(6));
      c.completion_cost_usd = Number((c.completion_cost_usd + t.completion_cost_usd).toFixed(6));
      c.total_cost_usd = Number((c.total_cost_usd + t.total_cost_usd).toFixed(6));
      c.failover_steps += t.failover_steps;
      c.failover_cost_delta_usd = Number(
        (c.failover_cost_delta_usd + t.failover_cost_delta_usd).toFixed(6)
      );

      if (t.total_cost_usd > c.max_task_cost_usd) {
        c.max_task_cost_usd = t.total_cost_usd;
      }

      if (!c.gateways.includes(t.gateway_slug)) c.gateways.push(t.gateway_slug);
      for (const m of t.models_used) {
        if (!c.models.includes(m)) c.models.push(m);
      }

      if (new Date(t.completed_at) > new Date(c.last_active_at)) {
        c.last_active_at = t.completed_at;
      }
    }

    const consumers = Array.from(consumerMap.values()).map((c) => {
      const denom = Math.max(1, c.tasks_completed || c.total_tasks);
      c.avg_steps_per_task = Number((c.total_steps / denom).toFixed(1));
      c.avg_tokens_per_task = Math.round(c.total_tokens / denom);
      c.avg_cost_per_task_usd = Number((c.total_cost_usd / denom).toFixed(6));
      c.budget_utilization_pct = Number(
        ((c.total_cost_usd / Math.max(0.0001, c.monthly_budget_usd)) * 100).toFixed(1)
      );
      return c;
    });

    consumers.sort((a, b) => b.total_cost_usd - a.total_cost_usd);

    // 5. Compute Global KPIs
    const totalSpendUsd = Number(
      tasks.reduce((acc, t) => acc + t.total_cost_usd, 0).toFixed(6)
    );
    const promptSpendUsd = Number(
      tasks.reduce((acc, t) => acc + t.prompt_cost_usd, 0).toFixed(6)
    );
    const completionSpendUsd = Number(
      tasks.reduce((acc, t) => acc + t.completion_cost_usd, 0).toFixed(6)
    );
    const totalTokens = tasks.reduce((acc, t) => acc + t.total_tokens, 0);
    const promptTokens = tasks.reduce((acc, t) => acc + t.prompt_tokens, 0);
    const completionTokens = tasks.reduce((acc, t) => acc + t.completion_tokens, 0);
    const completedTasksCount = tasks.filter((t) => t.task_status === 'completed').length;
    const taskDenom = Math.max(1, completedTasksCount || tasks.length);
    const totalSteps = tasks.reduce((acc, t) => acc + t.steps_count, 0);
    const failoverCostDeltaUsd = Number(
      tasks.reduce((acc, t) => acc + t.failover_cost_delta_usd, 0).toFixed(6)
    );
    const failoverStepsCount = tasks.reduce((acc, t) => acc + t.failover_steps, 0);

    return NextResponse.json({
      kpis: {
        total_spend_usd: totalSpendUsd,
        prompt_spend_usd: promptSpendUsd,
        completion_spend_usd: completionSpendUsd,
        total_tokens: totalTokens,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tasks: tasks.length,
        completed_tasks: completedTasksCount,
        total_steps: totalSteps,
        avg_cost_per_task_usd: Number((totalSpendUsd / taskDenom).toFixed(6)),
        avg_tokens_per_task: Math.round(totalTokens / taskDenom),
        avg_steps_per_task: Number((totalSteps / taskDenom).toFixed(1)),
        failover_cost_delta_usd: failoverCostDeltaUsd,
        failover_steps_count: failoverStepsCount,
        active_consumers_count: consumers.length,
      },
      consumers,
      tasks,
      rates: ratesRes.rows,
      budgets: budgetsRes.rows,
      gateways: gatewaysRes.rows,
    });
  } catch (err: any) {
    console.error('Failed to fetch FinOps analytics:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch FinOps analytics' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/finops
 * Simulates a realistic multi-step task for a consumer through an LLM Gateway,
 * recording each LLM call step with its exact token consumption and cost.
 */
export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const body = await req.json();
    const {
      consumer_id = 'agent-fin-01',
      consumer_name = '',
      gateway_slug = 'enterprise-chat',
      task_title = 'Multi-Step Autonomous Task Execution',
      steps_count = 3,
      simulate_failover_on_last_step = false,
    } = body;

    const gwRes = await pool.query(
      'SELECT * FROM llm_gateways WHERE slug = $1 AND org_id = $2 LIMIT 1',
      [gateway_slug, session.orgId]
    );
    const gateway = gwRes.rows[0];
    if (!gateway) {
      return NextResponse.json({ error: `LLM Gateway "${gateway_slug}" not found` }, { status: 404 });
    }

    const ratesRes = await pool.query(
      'SELECT provider, model, input_rate_per_1m, output_rate_per_1m FROM llm_model_rates WHERE org_id = $1',
      [session.orgId]
    );
    const customRates: ModelRate[] = ratesRes.rows || [];

    const bRes = await pool.query(
      'SELECT consumer_name FROM llm_consumer_budgets WHERE org_id = $1 AND consumer_id = $2',
      [session.orgId, consumer_id]
    );

    const effectiveConsumerName =
      consumer_name ||
      bRes.rows[0]?.consumer_name ||
      consumer_id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const taskId = `task_${consumer_id.replace(/[^a-z0-9]/gi, '').slice(0, 8)}_${Date.now().toString(36).slice(-5)}`;
    const primary = gateway.primary_backend || {};
    const fallbacks = gateway.fallback_backends || [];
    const authMode = gateway.inbound_auth?.mode || 'api_key';

    const stepTemplates = [
      { name: 'Step 1: Task Decomposition & Context Retrieval', promptTokens: 2150, completionTokens: 680 },
      { name: 'Step 2: Deep Domain Tool & RAG Synthesis', promptTokens: 3480, completionTokens: 1240 },
      { name: 'Step 3: Verification & Structured Artifact Output', promptTokens: 4120, completionTokens: 1690 },
      { name: 'Step 4: Executive Summary & Guardrail Audit', promptTokens: 1950, completionTokens: 820 },
    ];

    const numSteps = Math.min(4, Math.max(1, Number(steps_count) || 3));
    let totalTaskTokens = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTaskCostUsd = 0;

    for (let i = 0; i < numSteps; i++) {
      const tpl = stepTemplates[i] || stepTemplates[0];
      const isLast = i === numSteps - 1;
      const triggerFailover = Boolean(simulate_failover_on_last_step && isLast && fallbacks.length > 0);

      const provider = triggerFailover
        ? fallbacks[0].provider || 'aws_bedrock'
        : primary.provider || 'azure_openai';
      const model = triggerFailover
        ? fallbacks[0].model_alias || 'claude-3-5-sonnet'
        : primary.model_alias || 'gpt-4o';
      const region = triggerFailover
        ? fallbacks[0].region || 'us-east-1'
        : primary.region || 'eastus2';

      // Add slight realistic jitter to token counts
      const pTokens = tpl.promptTokens + Math.floor(Math.random() * 240);
      const cTokens = tpl.completionTokens + Math.floor(Math.random() * 140);
      const totTokens = pTokens + cTokens;
      const latency = 190 + Math.floor(Math.random() * 160);

      const costCalc = calculateCallCostUsd(provider, model, pTokens, cTokens, customRates);
      const baselineCost = triggerFailover
        ? calculateCallCostUsd(
            primary.provider || 'azure_openai',
            primary.model_alias || 'gpt-4o',
            pTokens,
            cTokens,
            customRates
          ).cost_usd
        : costCalc.cost_usd;

      await pool.query(
        `
        INSERT INTO llm_usage_ledger (
          org_id, gateway_id, gateway_slug, consumer_id, consumer_name, auth_mode,
          task_id, task_title, step_number, step_name, task_status,
          provider, model, region, failover_triggered,
          prompt_tokens, completion_tokens, total_tokens,
          cost_usd, prompt_cost_usd, completion_cost_usd, primary_baseline_cost_usd, latency_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        `,
        [
          session.orgId,
          gateway.id,
          gateway.slug,
          consumer_id,
          effectiveConsumerName,
          authMode,
          taskId,
          task_title,
          i + 1,
          triggerFailover ? `${tpl.name} (Failover)` : tpl.name,
          provider,
          model,
          region,
          triggerFailover,
          pTokens,
          cTokens,
          totTokens,
          costCalc.cost_usd,
          costCalc.prompt_cost_usd,
          costCalc.completion_cost_usd,
          baselineCost,
          latency,
        ]
      );

      totalPromptTokens += pTokens;
      totalCompletionTokens += cTokens;
      totalTaskTokens += totTokens;
      totalTaskCostUsd = Number((totalTaskCostUsd + costCalc.cost_usd).toFixed(6));
    }

    // Update LLM Gateway aggregate counters
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
            to_jsonb(COALESCE((metrics->>'requests_total')::bigint, 0) + $2::bigint)
          ),
          '{prompt_tokens}',
          to_jsonb(COALESCE((metrics->>'prompt_tokens')::bigint, 0) + $3::bigint)
        ),
        '{completion_tokens}',
        to_jsonb(COALESCE((metrics->>'completion_tokens')::bigint, 0) + $4::bigint)
      ),
      updated_at = NOW()
      WHERE id = $5
      `,
      [totalTaskTokens, numSteps, totalPromptTokens, totalCompletionTokens, gateway.id]
    );

    return NextResponse.json({
      success: true,
      simulated_task: {
        task_id: taskId,
        task_title,
        consumer_id,
        consumer_name: effectiveConsumerName,
        gateway_slug,
        steps_executed: numSteps,
        total_tokens: totalTaskTokens,
        total_cost_usd: totalTaskCostUsd,
      },
    });
  } catch (err: any) {
    console.error('Failed to simulate multi-step FinOps task:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to simulate FinOps task' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/finops
 * Updates Model Rate Card ($/1M input & output tokens) and/or Consumer Monthly Budgets,
 * and recalculates existing ledger costs when model rates are updated.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const body = await req.json();
    const { rates, budgets } = body;

    if (Array.isArray(rates)) {
      for (const r of rates) {
        if (!r.provider || !r.model) continue;
        const inRate = Math.max(0, Number(r.input_rate_per_1m) || 0);
        const outRate = Math.max(0, Number(r.output_rate_per_1m) || 0);

        await pool.query(
          `
          INSERT INTO llm_model_rates (org_id, provider, model, input_rate_per_1m, output_rate_per_1m, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (org_id, provider, model)
          DO UPDATE SET
            input_rate_per_1m = EXCLUDED.input_rate_per_1m,
            output_rate_per_1m = EXCLUDED.output_rate_per_1m,
            updated_at = NOW()
          `,
          [session.orgId, r.provider, r.model, inRate, outRate]
        );

        // Recalculate ledger entries for this provider + model so updated pricing is immediately reflected
        await pool.query(
          `
          UPDATE llm_usage_ledger
          SET
            prompt_cost_usd = ROUND(((prompt_tokens::numeric / 1000000.0) * $1::numeric), 6)::float8,
            completion_cost_usd = ROUND(((completion_tokens::numeric / 1000000.0) * $2::numeric), 6)::float8,
            cost_usd = ROUND((((prompt_tokens::numeric / 1000000.0) * $1::numeric) + ((completion_tokens::numeric / 1000000.0) * $2::numeric)), 6)::float8
          WHERE org_id = $3 AND provider = $4 AND model = $5
          `,
          [inRate, outRate, session.orgId, r.provider, r.model]
        );
      }
    }

    if (Array.isArray(budgets)) {
      for (const b of budgets) {
        if (!b.consumer_id) continue;
        const monthlyBudget = Math.max(0.01, Number(b.monthly_budget_usd) || 0.50);
        const highThreshold = Math.max(0.001, Number(b.high_cost_task_threshold_usd) || 0.045);

        await pool.query(
          `
          INSERT INTO llm_consumer_budgets (org_id, consumer_id, consumer_name, monthly_budget_usd, high_cost_task_threshold_usd, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (org_id, consumer_id)
          DO UPDATE SET
            consumer_name = COALESCE(EXCLUDED.consumer_name, llm_consumer_budgets.consumer_name),
            monthly_budget_usd = EXCLUDED.monthly_budget_usd,
            high_cost_task_threshold_usd = EXCLUDED.high_cost_task_threshold_usd,
            updated_at = NOW()
          `,
          [
            session.orgId,
            b.consumer_id,
            b.consumer_name || b.consumer_id,
            monthlyBudget,
            highThreshold,
          ]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Failed to update FinOps rates/budgets:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to update FinOps configuration' },
      { status: 500 }
    );
  }
}

