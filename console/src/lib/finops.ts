import { NextRequest } from 'next/server';

export interface ModelRate {
  provider: string;
  model: string;
  input_rate_per_1m: number;
  output_rate_per_1m: number;
}

export const DEFAULT_MODEL_RATES: ModelRate[] = [
  { provider: 'azure_openai', model: 'gpt-4o', input_rate_per_1m: 2.50, output_rate_per_1m: 10.00 },
  { provider: 'azure_openai', model: 'gpt-4o-mini', input_rate_per_1m: 0.15, output_rate_per_1m: 0.60 },
  { provider: 'openai_direct', model: 'gpt-4o', input_rate_per_1m: 2.50, output_rate_per_1m: 10.00 },
  { provider: 'openai_direct', model: 'gpt-4o-mini', input_rate_per_1m: 0.15, output_rate_per_1m: 0.60 },
  { provider: 'aws_bedrock', model: 'claude-3-5-sonnet', input_rate_per_1m: 3.00, output_rate_per_1m: 15.00 },
  { provider: 'anthropic_direct', model: 'claude-3.5-sonnet', input_rate_per_1m: 3.00, output_rate_per_1m: 15.00 },
  { provider: 'anthropic_direct', model: 'claude-3-5-sonnet', input_rate_per_1m: 3.00, output_rate_per_1m: 15.00 },
  { provider: 'anthropic_direct', model: 'claude-3-haiku', input_rate_per_1m: 0.25, output_rate_per_1m: 1.25 },
  { provider: 'google_vertex', model: 'gemini-1.5-pro', input_rate_per_1m: 1.25, output_rate_per_1m: 5.00 },
  { provider: 'ollama_vllm', model: 'llama-3.1-70b', input_rate_per_1m: 0.40, output_rate_per_1m: 0.80 },
];

export function findModelRate(
  provider: string,
  model: string,
  customRates: ModelRate[] = []
): { input_rate_per_1m: number; output_rate_per_1m: number } {
  const normProvider = (provider || '').toLowerCase().trim();
  const normModel = (model || '').toLowerCase().trim();

  const allRates = [...customRates, ...DEFAULT_MODEL_RATES];

  // 1. Exact provider + model match
  const exact = allRates.find(
    (r) => r.provider.toLowerCase() === normProvider && r.model.toLowerCase() === normModel
  );
  if (exact) {
    return {
      input_rate_per_1m: Number(exact.input_rate_per_1m),
      output_rate_per_1m: Number(exact.output_rate_per_1m),
    };
  }

  // 2. Model match across any provider
  const byModel = allRates.find(
    (r) => normModel.includes(r.model.toLowerCase()) || r.model.toLowerCase().includes(normModel)
  );
  if (byModel) {
    return {
      input_rate_per_1m: Number(byModel.input_rate_per_1m),
      output_rate_per_1m: Number(byModel.output_rate_per_1m),
    };
  }

  // 3. Fallback default rate (standard frontier tier)
  return { input_rate_per_1m: 2.50, output_rate_per_1m: 10.00 };
}

export function calculateCallCostUsd(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  customRates: ModelRate[] = []
): {
  cost_usd: number;
  prompt_cost_usd: number;
  completion_cost_usd: number;
  input_rate_per_1m: number;
  output_rate_per_1m: number;
} {
  const { input_rate_per_1m, output_rate_per_1m } = findModelRate(provider, model, customRates);
  const prompt_cost_usd = (Math.max(0, promptTokens) / 1_000_000) * input_rate_per_1m;
  const completion_cost_usd = (Math.max(0, completionTokens) / 1_000_000) * output_rate_per_1m;
  const cost_usd = Number((prompt_cost_usd + completion_cost_usd).toFixed(6));

  return {
    cost_usd,
    prompt_cost_usd: Number(prompt_cost_usd.toFixed(6)),
    completion_cost_usd: Number(completion_cost_usd.toFixed(6)),
    input_rate_per_1m,
    output_rate_per_1m,
  };
}

const KNOWN_CONSUMER_LABELS: Record<string, string> = {
  'agent-fin-01': 'Financial Research Synthesizer (A2A Agent)',
  'agent-code-02': 'Code Reviewer & Security Auditor (A2A Agent)',
  'agent-sup-03': 'Customer Support Escalation Agent',
  'agent-data-04': 'ETL Pipeline & Vector Ingestion Agent',
  'okta-marketing-copilot': 'Marketing Campaign Copilot (Okta PKCE)',
  'playground-sandbox': 'Console Interactive Playground',
};

/**
 * Priority chain for Consumer attribution:
 * 1. X-Consumer-ID header / body.metadata.consumer_id / body.consumer_id / body.user
 * 2. JWT sub or client_id claim (or gateway configured client_id)
 * 3. API Key identifier
 * 4. Fallback "anonymous-consumer"
 */
export function resolveConsumerIdentity(
  req: NextRequest,
  body: any,
  gateway: any,
  authMode: string,
  rawToken: string
): { consumer_id: string; consumer_name: string } {
  const headerConsumer = req.headers.get('x-consumer-id')?.trim();
  const headerConsumerName = req.headers.get('x-consumer-name')?.trim();
  const bodyConsumer =
    body?.metadata?.consumer_id?.trim?.() ||
    body?.consumer_id?.trim?.() ||
    (typeof body?.user === 'string' ? body.user.trim() : '');

  let consumerId = headerConsumer || bodyConsumer || '';

  // 2. Try decoding JWT payload if Bearer JWT was passed
  if (!consumerId && rawToken && rawToken.startsWith('ey') && rawToken.includes('.')) {
    try {
      const parts = rawToken.split('.');
      if (parts.length >= 2) {
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const claims = JSON.parse(payloadJson);
        consumerId = claims.sub || claims.client_id || claims.cid || claims.azp || '';
      }
    } catch {
      // ignore malformed JWT payload
    }
  }

  // Check simulated Okta tokens or gateway inbound_auth client_id
  if (!consumerId && (authMode === 'oauth_pkce' || authMode === 'client_credentials')) {
    if (rawToken && rawToken.startsWith('okta_')) {
      consumerId = rawToken.slice(0, 24);
    } else if (gateway?.inbound_auth?.client_id) {
      consumerId = `okta-client-${gateway.inbound_auth.client_id.slice(-6)}`;
    }
  }

  // 3. Check API key identifier
  if (!consumerId && rawToken) {
    if (rawToken.startsWith('sec_llm_')) {
      consumerId = `apikey-${rawToken.slice(0, 16)}`;
    } else {
      consumerId = `client-${rawToken.slice(0, 12)}`;
    }
  }

  // 4. Fallback
  if (!consumerId) {
    consumerId = 'anonymous-consumer';
  }

  const consumerName =
    headerConsumerName ||
    body?.metadata?.consumer_name ||
    KNOWN_CONSUMER_LABELS[consumerId] ||
    formatConsumerDisplayName(consumerId);

  return { consumer_id: consumerId, consumer_name: consumerName };
}

function formatConsumerDisplayName(consumerId: string): string {
  if (KNOWN_CONSUMER_LABELS[consumerId]) return KNOWN_CONSUMER_LABELS[consumerId];
  return consumerId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveTaskMetadata(
  req: NextRequest,
  body: any,
  promptSnippet: string
): {
  task_id: string;
  task_title: string;
  step_name: string;
  task_status: 'completed' | 'in_progress' | 'failed';
  is_explicit_task: boolean;
} {
  const headerTaskId = req.headers.get('x-task-id')?.trim();
  const bodyTaskId =
    body?.metadata?.task_id?.trim?.() ||
    body?.task_id?.trim?.() ||
    '';

  const explicitTaskId = headerTaskId || bodyTaskId;
  const isExplicit = Boolean(explicitTaskId);
  const taskId =
    explicitTaskId ||
    `task_single_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  const rawStatus = (
    req.headers.get('x-task-status') ||
    body?.metadata?.task_status ||
    body?.task_status ||
    'completed'
  )
    .toString()
    .toLowerCase()
    .trim();

  const taskStatus: 'completed' | 'in_progress' | 'failed' =
    rawStatus === 'in_progress' || rawStatus === 'running' || rawStatus === 'pending'
      ? 'in_progress'
      : rawStatus === 'failed' || rawStatus === 'error'
      ? 'failed'
      : 'completed';

  const trimmedPrompt = (promptSnippet || 'LLM Completion Task').slice(0, 68);
  const taskTitle =
    req.headers.get('x-task-title')?.trim() ||
    body?.metadata?.task_title?.trim?.() ||
    body?.task_title?.trim?.() ||
    (trimmedPrompt.length >= 68 ? `${trimmedPrompt}...` : trimmedPrompt);

  const stepName =
    req.headers.get('x-task-step')?.trim() ||
    body?.metadata?.step_name?.trim?.() ||
    body?.step_name?.trim?.() ||
    'LLM Completion Call';

  return {
    task_id: taskId,
    task_title: taskTitle,
    step_name: stepName,
    task_status: taskStatus,
    is_explicit_task: isExplicit,
  };
}

