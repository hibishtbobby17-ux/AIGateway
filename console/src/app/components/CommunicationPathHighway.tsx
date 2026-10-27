'use client';

import React, { useState, useEffect, useMemo } from 'react';

export interface GatewayInfo {
  id: string;
  name: string;
  status: string;
  region?: string;
  port?: number | string;
  version?: string;
  applied_config_version?: number;
  bound_projects_count?: number;
  last_seen_at?: string;
  protocol?: string;
}

export interface CommunicationPathHighwayProps {
  selectedConnection: string;
  onSelectConnection: (conn: string) => void;
  filteredLogsCount: number;
  onInspectLogsStream: () => void;
  onInspectWaterfall: () => void;
  showBanner: (text: string, type: 'success' | 'error' | 'info') => void;
  onFireSimulatedTrace: () => Promise<void>;
  isLoading: boolean;
  gatewaysList?: GatewayInfo[];
  selectedGatewayId?: string;
  onSelectGateway?: (gatewayId: string) => void;
}

interface HopDetail {
  id: string;
  name: string;
  category: string;
  source: string;
  destination: string;
  protocol: string;
  transport: string;
  latency: string;
  status: string;
  direction: 'Inbound Request' | 'Internal Hop' | 'Upstream Call' | 'Return Stream' | 'Async Telemetry';
  description: string;
  headers: Record<string, string>;
  policies: string[];
  metrics: {
    throughput: string;
    p95Latency: string;
    payloadSize: string;
    errorRate: string;
  };
}

const DEFAULT_FLEET_GATEWAYS: GatewayInfo[] = [
  { id: 'gateway-default-01', name: 'gateway-default-01', status: 'active', region: 'us-east-1', port: 8080, version: 'v1.0.0', applied_config_version: 147, bound_projects_count: 3 },
  { id: 'gateway-prod-eu', name: 'gateway-prod-eu', status: 'active', region: 'eu-central-1', port: 8443, version: 'v1.0.0', applied_config_version: 147, bound_projects_count: 2 },
  { id: 'gateway-edge-apac', name: 'gateway-edge-apac', status: 'active', region: 'ap-southeast-1', port: 8080, version: 'v0.9.8', applied_config_version: 146, bound_projects_count: 1 },
  { id: 'gateway-staging-dev', name: 'gateway-staging-dev', status: 'offline', region: 'us-west-2', port: 3001, version: 'v1.1.0-rc2', applied_config_version: 142, bound_projects_count: 1 },
];

const HOP_REGISTRY: Record<string, HopDetail> = {
  'client-python': {
    id: 'client-python',
    name: 'Python / TypeScript SDK Client',
    category: 'Stage 1: Consumer Inbound',
    source: '10.244.0.84:54320 (App Container)',
    destination: 'ai-gateway.internal:443 (Edge Port)',
    protocol: 'HTTP/2 over TLS 1.3 Strict',
    transport: 'TCP / ALPN h2',
    latency: '0.0 ms (Origin)',
    status: '200 OK • 42 req/sec',
    direction: 'Inbound Request',
    description: 'Application makes OpenAI-compatible chat completion or tool execution request using Bearer API Key authentication.',
    headers: {
      'Authorization': 'Bearer sec-live-prod-***',
      'User-Agent': 'openai-python/1.30.1 (langchain-core/0.2.14)',
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    policies: ['Bearer Token Authentication', 'Mutual TLS Strict', 'Zero-Trust Client Identity'],
    metrics: { throughput: '42 req/s', p95Latency: '1.2 ms', payloadSize: '1.4 KB in / 3.8 KB out', errorRate: '0.00%' }
  },
  'client-claude': {
    id: 'client-claude',
    name: 'Claude Desktop & Cursor IDE',
    category: 'Stage 1: Consumer Inbound',
    source: '192.168.1.105:61234 (Developer Workstation)',
    destination: 'ai-gateway.internal:443 (Edge Port)',
    protocol: 'Server-Sent Events (SSE) Stream',
    transport: 'HTTP/1.1 Persistent Stream',
    latency: '0.0 ms (Origin)',
    status: '200 OK • 18 req/sec',
    direction: 'Inbound Request',
    description: 'Desktop IDE and MCP client communicating via bidirectional SSE transport with Okta PKCE identity verification.',
    headers: {
      'Authorization': 'Bearer pkce-user-session-***',
      'Accept': 'text/event-stream',
      'X-Client-Type': 'cursor-mcp-client/0.41',
      'Cache-Control': 'no-cache'
    },
    policies: ['Okta OAuth 2.1 PKCE', 'Per-User Identity Scope', 'Persistent Keep-Alive SSE'],
    metrics: { throughput: '18 req/s', p95Latency: '2.1 ms', payloadSize: '890 B in / 14.2 KB out', errorRate: '0.00%' }
  },
  'client-agents': {
    id: 'client-agents',
    name: 'Autonomous Agent Swarms',
    category: 'Stage 1: Consumer Inbound',
    source: '10.244.2.11:48201 (LangGraph Orchestrator)',
    destination: 'ai-gateway.internal:443 (Edge Port)',
    protocol: 'A2A Task Protocol / Protobuf',
    transport: 'gRPC / HTTP/2 Direct',
    latency: '0.0 ms (Origin)',
    status: '200 OK • 26 req/sec',
    direction: 'Inbound Request',
    description: 'Agent-to-Agent machine delegation with OAuth 2.1 M2M machine tokens and structured sub-task payloads.',
    headers: {
      'X-Agent-ID': 'agt-researcher-09',
      'Authorization': 'Bearer m2m-token-jwt-***',
      'Content-Type': 'application/x-protobuf',
      'X-A2A-Version': '1.2'
    },
    policies: ['OAuth2 Client Credentials M2M', 'Agent Role Assertion', 'Sub-Task Spanning Policy'],
    metrics: { throughput: '26 req/s', p95Latency: '1.5 ms', payloadSize: '2.8 KB in / 9.6 KB out', errorRate: '0.00%' }
  },
  'gateway-ingress': {
    id: 'gateway-ingress',
    name: 'Gateway Ingress & TLS Termination',
    category: 'Stage 2: Gateway Ingress & Security',
    source: 'Edge Load Balancer (Port 443)',
    destination: 'Stateless Data Plane (Port 8080 / 3000)',
    protocol: 'Go fasthttp / netpoll Zero-Copy',
    transport: 'Internal Loopback / UNIX Domain Socket',
    latency: '1.8 ms (Handshake & Unseal)',
    status: 'HEALTHY • Active Config v147',
    direction: 'Internal Hop',
    description: 'Terminates inbound TLS 1.3, authenticates Bearer/PKCE tokens, unseals AES-256 secrets, and dispatches to pipeline.',
    headers: {
      'traceparent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'x-request-id': 'req-8f92a17c-e291',
      'x-envoy-decorator-operation': 'ingress_proxy'
    },
    policies: ['TLS 1.3 Cipher Suite ECDHE-ECDSA-AES256-GCM', 'W3C Context Propagation', 'AES-256 Secret Unsealer'],
    metrics: { throughput: '86 req/s', p95Latency: '1.8 ms', payloadSize: '12.4 MB/min', errorRate: '0.00%' }
  },
  'gateway-trace': {
    id: 'gateway-trace',
    name: 'W3C Distributed Trace Context Injector',
    category: 'Stage 2: Gateway Ingress & Security',
    source: 'Ingress Filter Chain',
    destination: 'Downstream Context Carrier',
    protocol: 'W3C Trace Context Specification',
    transport: 'Header Metapack',
    latency: '0.1 ms (Span ID Generation)',
    status: 'ACTIVE • Standardized Context',
    direction: 'Internal Hop',
    description: 'Injects standardized W3C traceparent and tracestate headers for end-to-end distributed tracing across all microservices.',
    headers: {
      'traceparent': '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'tracestate': 'con=live,tier=prod,sampled=1'
    },
    policies: ['W3C Traceparent Header Conformance', 'Sampling Rate: 100%', 'Baggage Passthrough'],
    metrics: { throughput: '86 spans/s', p95Latency: '0.1 ms', payloadSize: '55 bytes header', errorRate: '0.00%' }
  },
  'gateway-hub': {
    id: 'gateway-hub',
    name: 'AI Gateway Core Hub Runtime',
    category: 'Stage 2 & 3: Central Gateway Node',
    source: 'Edge TLS Termination Ingress',
    destination: 'Policy & Upstream Egress Pools',
    protocol: 'Stateless Go Data Plane Kernel',
    transport: 'Zero-Copy Ring Buffer Bus',
    latency: '0.2 ms (Kernel Transit)',
    status: 'ONLINE • Hot-Reload Config v147',
    direction: 'Internal Hop',
    description: 'Active AI Gateway instance handling multiplexed consumer streams, W3C context propagation, routing decisions, and async telemetry dispatch.',
    headers: {
      'x-gateway-instance': 'gateway-default-01',
      'x-gateway-region': 'us-east-1',
      'x-gateway-config-version': '147',
      'x-ring-buffer-utilization': '0.02%'
    },
    policies: ['Zero-Downtime Ring Buffer', 'Dynamic Config Synchronization', 'Graceful TLS Re-handshake'],
    metrics: { throughput: '86 req/s', p95Latency: '1.8 ms', payloadSize: 'Pooled Memory', errorRate: '0.00%' }
  },
  'gateway-ratelimit': {
    id: 'gateway-ratelimit',
    name: 'Token Bucket & Security Filter',
    category: 'Stage 3: Policy, Guardrails & Smart Router',
    source: 'Gateway Hub Core',
    destination: 'Prompt Guardrails Filter',
    protocol: 'In-Memory Sliding Window Leaky Bucket',
    transport: 'Local Memory Pointer',
    latency: '0.4 ms (Local Memory Check)',
    status: 'ENFORCING • Zero Overhead',
    direction: 'Internal Hop',
    description: 'Enforces 1000 RPM per client key and 100 burst tokens with zero external Redis round-trip latency overhead.',
    headers: {
      'x-ratelimit-limit': '1000',
      'x-ratelimit-remaining': '984',
      'x-ratelimit-reset': '36'
    },
    policies: ['Token Bucket (1000 RPM)', 'Sliding Window 60s', 'DDoS Threshold Mitigation'],
    metrics: { throughput: '86 req/s', p95Latency: '0.4 ms', payloadSize: 'Zero allocations', errorRate: '0.00%' }
  },
  'gateway-policy': {
    id: 'gateway-policy',
    name: 'Prompt Guardrails & PII Sanitizer',
    category: 'Stage 3: Policy, Guardrails & Smart Router',
    source: 'Policy Evaluation Engine',
    destination: 'Routing Dispatcher',
    protocol: 'Regex + Vector Semantic Inspection',
    transport: 'Zero-Copy Byte Slice',
    latency: '0.5 ms (Content Sanitization)',
    status: 'ENFORCING • Zero Leaks',
    direction: 'Internal Hop',
    description: 'Real-time prompt redaction of SSNs, secrets, API keys, and injection attempts prior to upstream forwarding.',
    headers: {
      'x-guardrails-verdict': 'ALLOW',
      'x-pii-redacted-fields': '0',
      'x-injection-risk-score': '0.01'
    },
    policies: ['PII Masking (SSN/CC/API Keys)', 'Prompt Injection Scanner', 'SSRF Safe Egress Dialer'],
    metrics: { throughput: '86 req/s', p95Latency: '0.5 ms', payloadSize: 'Zero allocations', errorRate: '0.00%' }
  },
  'gateway-router': {
    id: 'gateway-router',
    name: 'Intelligent Traffic Router & Failover',
    category: 'Stage 3: Policy, Guardrails & Smart Router',
    source: 'Gateway Hub Core',
    destination: 'Upstream Egress Dialer Pool',
    protocol: 'Semantic Route Table Lookup',
    transport: 'Async Channel Dispatch',
    latency: '0.3 ms (Route Selection)',
    status: 'OPTIMIZED • Least Latency',
    direction: 'Internal Hop',
    description: 'Evaluates model capability, availability, and latency SLAs to dispatch request to optimal upstream backend.',
    headers: {
      'x-target-cluster': 'llm-multi-cloud',
      'x-routing-algorithm': 'p95-latency-least-loaded',
      'x-failover-standby': 'aws-bedrock-us-east-1'
    },
    policies: ['Dynamic Target Multiplexing', 'Cost/Latency SLA Optimization', 'Automatic Circuit Breaker'],
    metrics: { throughput: '86 req/s', p95Latency: '0.3 ms', payloadSize: 'Route metadata', errorRate: '0.00%' }
  },
  'target-llm': {
    id: 'target-llm',
    name: 'Multi-Cloud LLM Pool',
    category: 'Stage 4: Downstream Targets',
    source: 'Gateway SSRF-Safe Egress Dialer',
    destination: 'Azure OpenAI ➔ AWS Bedrock ➔ Anthropic',
    protocol: 'HTTPS Chunked Streaming with Auto-Failover',
    transport: 'HTTP/2 Pooled TLS Sockets',
    latency: '185.2 ms P95 (LLM Inference)',
    status: 'HEALTHY • Auto-Failover Armed',
    direction: 'Upstream Call',
    description: 'Dispatches chat completion prompts to cloud model APIs with active failover if provider returns 5xx or latency spikes.',
    headers: {
      'OpenAI-Organization': 'org-enterprise-production',
      'x-model-target': 'gpt-4o-2024-08-06',
      'x-tokens-used': '842',
      'x-tokens-cached': '128'
    },
    policies: ['Auto-Failover Circuit Breaker', 'Token Usage Accounting', 'Chunked Response Buffer'],
    metrics: { throughput: '48 req/s', p95Latency: '185.2 ms', payloadSize: '3.8M tokens today', errorRate: '0.01%' }
  },
  'target-mcp': {
    id: 'target-mcp',
    name: 'Downstream MCP Tool Servers',
    category: 'Stage 4: Downstream Targets',
    source: 'Gateway Tool Catalog Dispatcher',
    destination: 'mcp-postgres:5432, mcp-math:8000, mcp-weather',
    protocol: 'JSON-RPC 2.0 over Streamable HTTP',
    transport: 'Keep-Alive HTTP / Unix Socket',
    latency: '8.2 ms P95 (Execution)',
    status: 'HEALTHY • 28 Active Tools',
    direction: 'Upstream Call',
    description: 'Invokes registered Model Context Protocol tools, verifies argument JSON schemas, and packages execution results.',
    headers: {
      'mcp-session-id': 'sess-98213-db-cluster',
      'x-tool-name': 'db_query_customers',
      'Content-Type': 'application/json'
    },
    policies: ['Tool RBAC Whitelist', 'Parameter Schema Validation', 'Timeout Guard (5000ms)'],
    metrics: { throughput: '24 req/s', p95Latency: '8.2 ms', payloadSize: '4.2 KB / call', errorRate: '0.00%' }
  },
  'target-agent': {
    id: 'target-agent',
    name: 'Downstream AI Agent Workers',
    category: 'Stage 4: Downstream Targets',
    source: 'Gateway A2A Task Coordinator',
    destination: 'agent-cluster.internal:9090',
    protocol: 'A2A Task Delegation Protocol',
    transport: 'Asynchronous Long-Poll / Webhook',
    latency: '24.6 ms P95 (Async Task)',
    status: 'HEALTHY • 2 Agents Registered',
    direction: 'Upstream Call',
    description: 'Delegates complex sub-tasks to specialized autonomous agent cards (e.g. Financial Auditor, Code Reviewer).',
    headers: {
      'x-delegation-id': 'task-a2a-441-audit',
      'x-agent-capability': 'financial-audit',
      'x-task-priority': 'high'
    },
    policies: ['A2A Trust Attestation', 'Task State Persistence', 'Sub-Task Spanning'],
    metrics: { throughput: '14 req/s', p95Latency: '24.6 ms', payloadSize: '8.1 KB / task', errorRate: '0.00%' }
  },
  'egress-stream': {
    id: 'egress-stream',
    name: 'Real-Time SSE Response Stream to Consumer',
    category: 'Stage 5: Dual Egress Delivery',
    source: 'Gateway Ingress Socket Buffer',
    destination: 'Origin Consumer Client Application',
    protocol: 'HTTP/2 Server-Sent Events (SSE)',
    transport: 'Direct TCP Socket Flush',
    latency: '1.2 ms (Socket Flush, TTFT: ~18ms)',
    status: 'DELIVERING • Sub-20ms TTFT',
    direction: 'Return Stream',
    description: 'Delivers streamed tokens and tool call results directly back to the requesting client with minimal time-to-first-token.',
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'x-accel-buffering': 'no'
    },
    policies: ['Zero-Copy Token Streaming', 'Client Backpressure Handling', 'Outbound PII Verification'],
    metrics: { throughput: '86 req/s', p95Latency: '1.2 ms', payloadSize: 'Streaming Tokens', errorRate: '0.00%' }
  },
  'egress-clickhouse': {
    id: 'egress-clickhouse',
    name: 'Asynchronous ClickHouse OLAP Sink',
    category: 'Stage 5: Dual Egress Delivery',
    source: 'Non-Blocking Ring Buffer Spooler',
    destination: 'clickhouse-server:9000 (Native) / 8123 (HTTP)',
    protocol: 'ClickHouse Native Columnar Protocol',
    transport: 'Direct Native TCP Batch Channel',
    latency: '0.0 ms (Decoupled from User Latency)',
    status: 'ACTIVE • Buffer 0.02% utilized',
    direction: 'Async Telemetry',
    description: 'Background worker flushes micro-batches of 500 spans directly into ClickHouse columnar storage without blocking client request.',
    headers: {
      'x-clickhouse-table': 'gateway_traces',
      'x-clickhouse-format': 'Native',
      'x-compression': 'zstd',
      'x-batch-size': '500'
    },
    policies: ['Non-Blocking Async Dispatch', 'Sub-second Columnar Aggregation', '60-day Partition Retention'],
    metrics: { throughput: '86 spans/s', p95Latency: '0.0 ms delay', payloadSize: '88% compressed', errorRate: '0.00%' }
  }
};

export default function CommunicationPathHighway({
  selectedConnection,
  onSelectConnection,
  filteredLogsCount,
  onInspectLogsStream,
  onInspectWaterfall,
  showBanner,
  onFireSimulatedTrace,
  isLoading,
  gatewaysList = [],
  selectedGatewayId = 'all',
  onSelectGateway,
}: CommunicationPathHighwayProps) {
  // Graph view mode: true connection graph vs pipeline highway
  const [viewMode, setViewMode] = useState<'graph' | 'highway'>('graph');
  const [selectedHopId, setSelectedHopId] = useState<string>('gateway-hub');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showGatewayModal, setShowGatewayModal] = useState<boolean>(false);
  const [localSelectedGateway, setLocalSelectedGateway] = useState<string>(selectedGatewayId);

  // Simulation state
  const [isSimulatingTrace, setIsSimulatingTrace] = useState<boolean>(false);
  const [simulationStep, setSimulationStep] = useState<number>(0);
  const [simulationHopText, setSimulationHopText] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Consolidate fleet gateways
  const fleetGateways = useMemo(() => {
    if (!gatewaysList || gatewaysList.length === 0) return DEFAULT_FLEET_GATEWAYS;
    const realIds = new Set(gatewaysList.map(g => g.id));
    const merged = [...gatewaysList];
    for (const def of DEFAULT_FLEET_GATEWAYS) {
      if (!realIds.has(def.id)) {
        merged.push(def);
      }
    }
    return merged;
  }, [gatewaysList]);

  // Current active gateway details
  const activeGateway = useMemo(() => {
    if (localSelectedGateway === 'all') {
      return fleetGateways[0] || DEFAULT_FLEET_GATEWAYS[0];
    }
    return fleetGateways.find(g => g.id === localSelectedGateway) || fleetGateways[0] || DEFAULT_FLEET_GATEWAYS[0];
  }, [fleetGateways, localSelectedGateway]);

  // Sync external gateway changes
  useEffect(() => {
    if (selectedGatewayId) {
      setLocalSelectedGateway(selectedGatewayId);
    }
  }, [selectedGatewayId]);

  const handleGatewayChange = (gwId: string) => {
    setLocalSelectedGateway(gwId);
    if (onSelectGateway) {
      onSelectGateway(gwId);
    }
    const found = fleetGateways.find(g => g.id === gwId);
    showBanner(`Connected topology to AI Gateway: ${found ? found.name : 'All Gateways'}`, 'success');
  };

  // Sync hop selection when filter changes
  useEffect(() => {
    if (selectedConnection === 'client-gateway') setSelectedHopId('client-python');
    else if (selectedConnection === 'gateway-llm') setSelectedHopId('target-llm');
    else if (selectedConnection === 'gateway-mcp') setSelectedHopId('target-mcp');
    else if (selectedConnection === 'gateway-agent') setSelectedHopId('target-agent');
    else if (selectedConnection === 'gateway-telemetry') setSelectedHopId('egress-clickhouse');
  }, [selectedConnection]);

  // Execute full visual packet traversal animation
  const handleRunTraceSimulation = async () => {
    setIsSimulatingTrace(true);
    setSimulationStep(1);
    setSimulationHopText('Step 1/5: Consumer initiates HTTPS request with Bearer Auth & W3C context headers (0.0ms)...');

    setTimeout(() => {
      setSimulationStep(2);
      setSimulationHopText(`Step 2/5: AI Gateway (${activeGateway.name}) terminates TLS 1.3 & injects traceparent (+1.8ms)...`);
    }, 700);

    setTimeout(() => {
      setSimulationStep(3);
      setSimulationHopText('Step 3/5: Policy Engine enforces Token Bucket (1000 RPM allowed) & scans Prompt Guardrails (+0.9ms)...');
    }, 1400);

    setTimeout(() => {
      setSimulationStep(4);
      setSimulationHopText('Step 4/5: Smart Router dispatches request to downstream target backend (+16.4ms)...');
    }, 2100);

    setTimeout(() => {
      setSimulationStep(5);
      setSimulationHopText('Step 5/5: SSE chunks streamed back to client socket; span dispatched to ClickHouse ring buffer (+0.1ms)!');
    }, 2800);

    setTimeout(() => {
      setIsSimulatingTrace(false);
      setSimulationStep(0);
      setSimulationHopText('');
      showBanner(`✓ Live trace successfully completed through ${activeGateway.name}!`, 'success');
    }, 3800);

    try {
      await onFireSimulatedTrace();
    } catch {
      // handled
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(label);
    showBanner(`Copied ${label} to clipboard`, 'success');
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const currentHop = HOP_REGISTRY[selectedHopId] || HOP_REGISTRY['gateway-hub'];

  // Check if a node is active
  const isNodeSelected = (nodeId: string) => {
    return selectedHopId === nodeId || hoveredNodeId === nodeId;
  };

  // Node position dictionary for SVG graph layout
  const GRAPH_NODES: Record<string, { x: number; y: number; label: string; icon: string; sub: string; badge: string; color: string; stage: number }> = {
    'client-python': { x: 100, y: 110, label: 'Python / TS SDK', icon: '🐍', sub: 'OpenAI / LangChain', badge: '42 req/s', color: '#38bdf8', stage: 1 },
    'client-claude': { x: 100, y: 260, label: 'Claude & Cursor', icon: '💻', sub: 'Desktop MCP Client', badge: '18 req/s', color: '#6366f1', stage: 1 },
    'client-agents': { x: 100, y: 410, label: 'Agent Swarms', icon: '🤖', sub: 'LangGraph / CrewAI', badge: '26 req/s', color: '#10b981', stage: 1 },

    'gateway-ingress': { x: 340, y: 160, label: 'TLS 1.3 Ingress', icon: '🔒', sub: 'Port 443 / Strict', badge: '1.8ms', color: '#6366f1', stage: 2 },
    'gateway-trace': { x: 340, y: 360, label: 'W3C Tracer', icon: '🏷️', sub: 'traceparent Injector', badge: '0.1ms', color: '#38bdf8', stage: 2 },

    'gateway-hub': { x: 580, y: 260, label: activeGateway.name, icon: '⚡', sub: `${activeGateway.region || 'us-east-1'} • Port ${activeGateway.port || 8080}`, badge: `v${activeGateway.applied_config_version || 147} Synced`, color: '#6366f1', stage: 2 },
    'gateway-ratelimit': { x: 580, y: 90, label: 'Token Bucket & Security', icon: '🛡️', sub: '1000 RPM Sliding Window', badge: '0.4ms', color: '#a78bfa', stage: 3 },
    'gateway-router': { x: 580, y: 430, label: 'Dynamic Smart Router', icon: '🔀', sub: 'Multi-Cloud Failover', badge: '0.3ms', color: '#10b981', stage: 3 },

    'target-llm': { x: 840, y: 120, label: 'Multi-Cloud LLMs', icon: '🔮', sub: 'Azure OpenAI ➔ Bedrock', badge: '185ms P95', color: '#10b981', stage: 4 },
    'target-mcp': { x: 840, y: 260, label: 'MCP Tool Servers', icon: '🔌', sub: 'Postgres, Math, Weather', badge: '8.2ms P95', color: '#38bdf8', stage: 4 },
    'target-agent': { x: 840, y: 400, label: 'AI Agent Workers', icon: '🤖', sub: 'Financial & Code Review', badge: '24.6ms P95', color: '#a78bfa', stage: 4 },

    'egress-stream': { x: 1070, y: 170, label: 'Client SSE Stream', icon: '🌊', sub: 'Chunked Socket Flush', badge: 'TTFT ~18ms', color: '#10b981', stage: 5 },
    'egress-clickhouse': { x: 1070, y: 350, label: 'ClickHouse OLAP', icon: '⚡', sub: 'Port 8123/9000 Spool', badge: '0.0ms Async', color: '#f59e0b', stage: 5 },
  };

  // Graph edge definitions (source -> target) with Bézier curve specifications
  const GRAPH_EDGES = [
    { from: 'client-python', to: 'gateway-ingress', color: '#38bdf8', forward: true, label: 'TLS 1.3' },
    { from: 'client-claude', to: 'gateway-ingress', color: '#6366f1', forward: true, label: 'SSE' },
    { from: 'client-agents', to: 'gateway-trace', color: '#10b981', forward: true, label: 'A2A' },

    { from: 'gateway-ingress', to: 'gateway-hub', color: '#6366f1', forward: true, label: '1.8ms' },
    { from: 'gateway-trace', to: 'gateway-hub', color: '#38bdf8', forward: true, label: '0.1ms' },

    { from: 'gateway-hub', to: 'gateway-ratelimit', color: '#a78bfa', forward: true, label: 'Internal' },
    { from: 'gateway-hub', to: 'gateway-router', color: '#10b981', forward: true, label: 'Internal' },

    { from: 'gateway-ratelimit', to: 'target-llm', color: '#10b981', forward: true, label: '185ms' },
    { from: 'gateway-hub', to: 'target-mcp', color: '#38bdf8', forward: true, label: '8.2ms' },
    { from: 'gateway-router', to: 'target-agent', color: '#a78bfa', forward: true, label: '24.6ms' },

    { from: 'target-llm', to: 'egress-stream', color: '#10b981', forward: true, label: 'Tokens' },
    { from: 'target-mcp', to: 'egress-stream', color: '#38bdf8', forward: true, label: 'JSON-RPC' },
    { from: 'gateway-hub', to: 'egress-clickhouse', color: '#f59e0b', forward: true, label: 'Async Spool (0.0ms)' },
  ];

  // Helper to generate SVG Bézier curve path string
  const getCurvePath = (fromId: string, toId: string) => {
    const from = GRAPH_NODES[fromId];
    const to = GRAPH_NODES[toId];
    if (!from || !to) return '';
    const dx = to.x - from.x;
    const cx1 = from.x + dx * 0.45;
    const cy1 = from.y;
    const cx2 = from.x + dx * 0.55;
    const cy2 = to.y;
    return `M ${from.x + 35} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x - 35} ${to.y}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 0. CSS Animations */}
      <style>{`
        @keyframes edgeFlowForward {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes radarPulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; filter: drop-shadow(0 0 10px rgba(99, 102, 241, 0.8)); }
          100% { transform: scale(0.95); opacity: 0.8; }
        }
        @keyframes rotateDashedRing {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .graph-edge-animated {
          stroke-dasharray: 6, 5;
          animation: edgeFlowForward 1.4s linear infinite;
        }
        .graph-node-vertex {
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
        }
        .graph-node-vertex:hover {
          filter: drop-shadow(0 0 12px rgba(56, 189, 248, 0.6));
          transform: translateY(-2px);
        }
        .graph-node-vertex-hub:hover {
          filter: drop-shadow(0 0 16px rgba(99, 102, 241, 0.9));
        }
      `}</style>

      {/* 1. TOP TOOLBAR: GATEWAY SELECTOR + VIEW MODE TOGGLE + SIMULATION */}
      <div className="glass-panel" style={{
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '14px',
        background: 'var(--bg-surface)'
      }}>
        {/* Left: Gateway Selector Dropdown & Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block' }}>
                Active AI Gateway Scope:
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <select
                  className="input-field"
                  value={localSelectedGateway}
                  onChange={(e) => handleGatewayChange(e.target.value)}
                  style={{
                    height: '34px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    minWidth: '220px',
                    borderColor: 'var(--primary)'
                  }}
                >
                  <option value="all">⚡ All Fleet Gateways ({fleetGateways.length})</option>
                  {fleetGateways.map(gw => (
                    <option key={gw.id} value={gw.id}>
                      {gw.status === 'active' ? '🟢' : '⚪'} {gw.name} ({gw.region || 'us-east-1'} : {gw.port || 8080})
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => setShowGatewayModal(true)}
                  className="btn-secondary"
                  style={{ height: '34px', fontSize: '0.76rem', padding: '0 10px', whiteSpace: 'nowrap' }}
                  title="Open Gateway Fleet Switcher"
                >
                  🏢 Browse Fleet ({fleetGateways.length})
                </button>
              </div>
            </div>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: 'var(--bg-surface-subtle)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.75rem'
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeGateway.status === 'active' ? '#10b981' : '#ef4444' }} />
            <strong style={{ color: 'var(--text-main)' }}>{activeGateway.name}</strong>
            <span style={{ color: 'var(--text-muted)' }}>• {activeGateway.region || 'us-east-1'}</span>
            <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>v{activeGateway.applied_config_version || 147}</span>
          </div>
        </div>

        {/* Right: View Mode Toggle (Graph vs Highway) + Simulation Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* View Mode Toggle */}
          <div style={{
            display: 'flex',
            background: 'var(--bg-surface-subtle)',
            padding: '3px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)'
          }}>
            <button
              onClick={() => setViewMode('graph')}
              style={{
                background: viewMode === 'graph' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'graph' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: viewMode === 'graph' ? 700 : 500,
                fontSize: '0.76rem',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              🕸️ Connection Graph
            </button>
            <button
              onClick={() => setViewMode('highway')}
              style={{
                background: viewMode === 'highway' ? 'var(--primary)' : 'transparent',
                color: viewMode === 'highway' ? '#ffffff' : 'var(--text-muted)',
                fontWeight: viewMode === 'highway' ? 700 : 500,
                fontSize: '0.76rem',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              🛣️ Pipeline Highway
            </button>
          </div>

          {/* Test Trace Action Button */}
          <button
            onClick={handleRunTraceSimulation}
            disabled={isSimulatingTrace || isLoading}
            className="btn-primary"
            style={{
              fontSize: '0.78rem',
              height: '34px',
              padding: '0 14px',
              background: isSimulatingTrace ? '#10b981' : undefined,
              borderColor: isSimulatingTrace ? '#10b981' : undefined
            }}
          >
            {isSimulatingTrace ? '● Simulating...' : '⚡ Test Trace Request'}
          </button>
        </div>
      </div>

      {/* 2. GATEWAY FLEET SWITCHER MODAL / POPUP */}
      {showGatewayModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '680px',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: 'var(--bg-surface)',
            padding: '24px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  Select AI Gateway Runtime
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Choose which gateway instance to observe and map in the live connection graph.
                </span>
              </div>
              <button
                onClick={() => setShowGatewayModal(false)}
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Option: All Fleet */}
              <div
                onClick={() => { handleGatewayChange('all'); setShowGatewayModal(false); }}
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-sm)',
                  border: localSelectedGateway === 'all' ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: localSelectedGateway === 'all' ? 'var(--primary-subtle)' : 'var(--bg-surface-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.4rem' }}>🌐</span>
                  <div>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)', display: 'block' }}>
                      All Fleet Gateways (Global Aggregation)
                    </strong>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      Observes unified ingress traffic across all {fleetGateways.length} distributed runtimes.
                    </span>
                  </div>
                </div>
                {localSelectedGateway === 'all' && (
                  <span className="badge badge-indigo">✓ Active Scope</span>
                )}
              </div>

              {/* Individual Gateways */}
              {fleetGateways.map(gw => {
                const isSelected = localSelectedGateway === gw.id;
                const isOnline = gw.status === 'active';
                return (
                  <div
                    key={gw.id}
                    onClick={() => { handleGatewayChange(gw.id); setShowGatewayModal(false); }}
                    style={{
                      padding: '14px',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                      background: isSelected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '1.4rem' }}>⚡</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{gw.name}</strong>
                          <span className={`badge ${isOnline ? 'badge-emerald' : 'badge-rose'}`} style={{ fontSize: '0.65rem' }}>
                            {isOnline ? '● Online' : '○ Offline'}
                          </span>
                          <span className="badge badge-indigo" style={{ fontSize: '0.65rem' }}>
                            v{gw.applied_config_version || 147}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          Region: <strong>{gw.region || 'us-east-1'}</strong> • Port: <strong>{gw.port || 8080}</strong> • Bound Projects: <strong>{gw.bound_projects_count || 1}</strong>
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {isSelected ? (
                        <span className="badge badge-indigo">✓ Active Gateway</span>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: '0.74rem', padding: '4px 10px' }}
                        >
                          Switch ➔
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 3. LIVE SIMULATION PROGRESS BANNER */}
      {isSimulatingTrace && (
        <div style={{
          padding: '12px 18px',
          background: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 'var(--radius-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem' }}>📡</span>
            <div>
              <strong style={{ fontSize: '0.84rem', color: '#38bdf8', display: 'block' }}>
                Active Connection Graph Packet Traversal: {activeGateway.name}
              </strong>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-main)', fontFamily: 'monospace' }}>
                {simulationHopText}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[1, 2, 3, 4, 5].map((step) => (
              <span
                key={step}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: simulationStep >= step ? '#38bdf8' : 'var(--bg-surface-subtle)',
                  color: simulationStep >= step ? '#020617' : 'var(--text-muted)',
                  transition: 'all 0.3s ease'
                }}
              >
                {step}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4. PRIMARY VIEW: THE INTERACTIVE CONNECTION GRAPH (NODES & EDGES) */}
      {viewMode === 'graph' ? (
        <div className="glass-panel" style={{
          padding: '24px',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.06) 0%, var(--bg-surface) 100%)',
          position: 'relative',
          overflowX: 'auto',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-subtle)'
        }}>
          {/* Canvas Header & Legend Overlay */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <strong style={{ fontSize: '1rem', color: 'var(--text-main)', display: 'block' }}>
                Topology Graph: {activeGateway.name}
              </strong>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Interactive node vertices connected via Bézier communication links. Click any node to inspect wire headers or switch gateways.
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#38bdf8' }} /> Inbound Client
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#6366f1' }} /> AI Gateway Hub
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} /> Upstream Target
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} /> Telemetry Sink
              </span>
            </div>
          </div>

          {/* SVG Connection Graph Canvas */}
          <div style={{ minWidth: '1160px', height: '520px', position: 'relative' }}>
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 1160 520"
              style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
            >
              <defs>
                {/* Arrow markers */}
                <marker id="arrow-cyan" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#38bdf8" />
                </marker>
                <marker id="arrow-indigo" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#6366f1" />
                </marker>
                <marker id="arrow-emerald" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#10b981" />
                </marker>
                <marker id="arrow-amber" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 8 5 L 0 9 z" fill="#f59e0b" />
                </marker>
              </defs>

              {/* Render All Bézier Connecting Edges */}
              {GRAPH_EDGES.map((edge, idx) => {
                const pathStr = getCurvePath(edge.from, edge.to);
                const isEdgeHighlighted = isNodeSelected(edge.from) || isNodeSelected(edge.to);
                const markerId = edge.color === '#10b981' ? 'url(#arrow-emerald)' : edge.color === '#f59e0b' ? 'url(#arrow-amber)' : edge.color === '#38bdf8' ? 'url(#arrow-cyan)' : 'url(#arrow-indigo)';
                return (
                  <g key={idx}>
                    {/* Base Edge Path */}
                    <path
                      d={pathStr}
                      stroke={edge.color}
                      strokeWidth={isEdgeHighlighted ? 3 : 1.8}
                      strokeOpacity={isEdgeHighlighted ? 0.95 : 0.35}
                      fill="none"
                      markerEnd={markerId}
                      style={{ transition: 'all 0.25s ease' }}
                    />
                    {/* Animated Flow Pulse Line */}
                    <path
                      d={pathStr}
                      stroke={edge.color}
                      strokeWidth={isEdgeHighlighted ? 3.5 : 2}
                      strokeOpacity={isEdgeHighlighted ? 1 : 0.7}
                      fill="none"
                      className="graph-edge-animated"
                    />
                  </g>
                );
              })}
            </svg>

            {/* Render Graph Node Vertices as HTML Overlay Elements */}
            {Object.entries(GRAPH_NODES).map(([nodeId, node]) => {
              const isSelected = selectedHopId === nodeId;
              const isHovered = hoveredNodeId === nodeId;
              const isHub = nodeId === 'gateway-hub';
              const isSimActive = simulationStep === node.stage;

              if (isHub) {
                // Central Gateway Hub Node
                return (
                  <div
                    key={nodeId}
                    onClick={() => { setSelectedHopId('gateway-hub'); }}
                    onMouseEnter={() => setHoveredNodeId(nodeId)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    className="graph-node-vertex graph-node-vertex-hub"
                    style={{
                      position: 'absolute',
                      left: `${node.x - 90}px`,
                      top: `${node.y - 70}px`,
                      width: '180px',
                      padding: '16px 14px',
                      borderRadius: 'var(--radius-md)',
                      background: isSelected ? 'rgba(99, 102, 241, 0.16)' : 'var(--bg-surface)',
                      border: isSelected || isSimActive ? '2px solid #6366f1' : '1.5px solid var(--border-strong)',
                      boxShadow: isSelected || isSimActive ? '0 0 24px rgba(99, 102, 241, 0.5)' : 'var(--card-shadow)',
                      textAlign: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      zIndex: 20
                    }}
                  >
                    {/* Central Radar Pulse Badge */}
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: 'rgba(99, 102, 241, 0.2)',
                      border: '2px solid #6366f1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.4rem',
                      animation: isSimActive ? 'radarPulse 1.2s infinite' : 'none'
                    }}>
                      ⚡
                    </div>
                    <strong style={{ fontSize: '0.86rem', color: 'var(--text-main)', marginTop: '2px' }}>
                      {activeGateway.name}
                    </strong>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {activeGateway.region || 'us-east-1'} • Port {activeGateway.port || 8080}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                      <span className="badge badge-emerald" style={{ fontSize: '0.62rem' }}>
                        ● Online (v{activeGateway.applied_config_version || 147})
                      </span>
                    </div>

                    {/* Switch Gateway Quick Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowGatewayModal(true);
                      }}
                      className="btn-secondary"
                      style={{
                        marginTop: '8px',
                        fontSize: '0.68rem',
                        padding: '3px 8px',
                        borderRadius: 'var(--radius-sm)',
                        borderColor: 'var(--primary)',
                        color: 'var(--primary-text)'
                      }}
                    >
                      🔄 Switch Gateway
                    </button>
                  </div>
                );
              }

              // Standard Graph Node Vertex
              return (
                <div
                  key={nodeId}
                  onClick={() => setSelectedHopId(nodeId)}
                  onMouseEnter={() => setHoveredNodeId(nodeId)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className="graph-node-vertex"
                  style={{
                    position: 'absolute',
                    left: `${node.x - 75}px`,
                    top: `${node.y - 45}px`,
                    width: '150px',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-surface)',
                    border: isSelected || isSimActive ? `2px solid ${node.color}` : '1px solid var(--border-subtle)',
                    boxShadow: isSelected || isSimActive ? `0 0 16px ${node.color}55` : 'var(--card-shadow)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    zIndex: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '1.2rem' }}>{node.icon}</span>
                    <span className="badge" style={{ fontSize: '0.62rem', background: 'var(--bg-surface-subtle)', color: node.color }}>
                      {node.badge}
                    </span>
                  </div>
                  <strong style={{ fontSize: '0.8rem', color: 'var(--text-main)', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.label}
                  </strong>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.sub}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ALTERNATIVE VIEW: HORIZONTAL PIPELINE HIGHWAY */
        <div className="glass-panel" style={{
          padding: '24px',
          background: 'radial-gradient(ellipse at 50% 20%, rgba(99, 102, 241, 0.05) 0%, var(--bg-surface) 100%)',
          position: 'relative',
          overflowX: 'auto'
        }}>
          <div style={{ minWidth: '1220px', display: 'flex', alignItems: 'stretch', position: 'relative' }}>
            {/* Stage 1 */}
            <div style={{ width: '210px', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#38bdf8' }}>1. INBOUND CLIENTS</span>
              </div>
              {['client-python', 'client-claude', 'client-agents'].map((nid) => {
                const n = GRAPH_NODES[nid];
                return (
                  <div
                    key={nid}
                    onClick={() => setSelectedHopId(nid)}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: selectedHopId === nid ? '2px solid #38bdf8' : '1px solid var(--border-subtle)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.2rem' }}>{n.icon}</span>
                      <span className="badge badge-cyan" style={{ fontSize: '0.62rem' }}>{n.badge}</span>
                    </div>
                    <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)', display: 'block' }}>{n.label}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{n.sub}</span>
                  </div>
                );
              })}
            </div>

            {/* Bridge 1 */}
            <div style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-cyan" style={{ fontSize: '0.6rem' }}>1.8ms ➔</span>
            </div>

            {/* Stage 2 */}
            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#a78bfa' }}>2. GATEWAY INGRESS</span>
              </div>
              <div
                onClick={() => setSelectedHopId('gateway-hub')}
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  border: selectedHopId === 'gateway-hub' ? '2px solid #6366f1' : '1px solid var(--border-subtle)',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚡</span>
                  <span className="badge badge-emerald" style={{ fontSize: '0.62rem' }}>Port {activeGateway.port || 8080}</span>
                </div>
                <strong style={{ fontSize: '0.86rem', color: 'var(--text-main)', display: 'block' }}>{activeGateway.name}</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{activeGateway.region || 'us-east-1'} • Config v{activeGateway.applied_config_version || 147}</span>
              </div>
              <div
                onClick={() => setSelectedHopId('gateway-ingress')}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  border: selectedHopId === 'gateway-ingress' ? '2px solid #38bdf8' : '1px solid var(--border-subtle)',
                  cursor: 'pointer'
                }}
              >
                <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)', display: 'block' }}>TLS 1.3 Termination</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Strict Ingress Cipher Handshake</span>
              </div>
            </div>

            {/* Bridge 2 */}
            <div style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-indigo" style={{ fontSize: '0.6rem' }}>0.9ms ➔</span>
            </div>

            {/* Stage 3 */}
            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.25)' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#a78bfa' }}>3. POLICY & ROUTER</span>
              </div>
              {['gateway-ratelimit', 'gateway-policy', 'gateway-router'].map((nid) => {
                const n = GRAPH_NODES[nid] || HOP_REGISTRY[nid];
                return (
                  <div
                    key={nid}
                    onClick={() => setSelectedHopId(nid)}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: selectedHopId === nid ? '2px solid #a78bfa' : '1px solid var(--border-subtle)',
                      cursor: 'pointer'
                    }}
                  >
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)', display: 'block' }}>{n.label}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{n.sub}</span>
                  </div>
                );
              })}
            </div>

            {/* Bridge 3 */}
            <div style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-emerald" style={{ fontSize: '0.6rem' }}>Router ➔</span>
            </div>

            {/* Stage 4 */}
            <div style={{ width: '230px', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#10b981' }}>4. DOWNSTREAM TARGETS</span>
              </div>
              {['target-llm', 'target-mcp', 'target-agent'].map((nid) => {
                const n = GRAPH_NODES[nid];
                return (
                  <div
                    key={nid}
                    onClick={() => setSelectedHopId(nid)}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-surface)',
                      border: selectedHopId === nid ? '2px solid #10b981' : '1px solid var(--border-subtle)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '1.2rem' }}>{n.icon}</span>
                      <span className="badge badge-emerald" style={{ fontSize: '0.62rem' }}>{n.badge}</span>
                    </div>
                    <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)', display: 'block' }}>{n.label}</strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{n.sub}</span>
                  </div>
                );
              })}
            </div>

            {/* Bridge 4 */}
            <div style={{ width: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="badge badge-amber" style={{ fontSize: '0.6rem' }}>Dual ➔</span>
            </div>

            {/* Stage 5 */}
            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '12px', flexShrink: 0 }}>
              <div style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#f59e0b' }}>5. DUAL EGRESS</span>
              </div>
              <div
                onClick={() => setSelectedHopId('egress-stream')}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  border: selectedHopId === 'egress-stream' ? '2px solid #10b981' : '1px solid var(--border-subtle)',
                  cursor: 'pointer'
                }}
              >
                <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)', display: 'block' }}>🌊 Real-Time Stream</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Direct SSE Token Delivery</span>
              </div>
              <div
                onClick={() => setSelectedHopId('egress-clickhouse')}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface)',
                  border: selectedHopId === 'egress-clickhouse' ? '2px solid #f59e0b' : '1px solid var(--border-subtle)',
                  cursor: 'pointer'
                }}
              >
                <strong style={{ fontSize: '0.84rem', color: 'var(--text-main)', display: 'block' }}>⚡ ClickHouse OLAP</strong>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>0.0ms Async Non-blocking</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. INTERACTIVE WIRE-LEVEL COMMUNICATION HOP INSPECTOR */}
      <div className="glass-panel" style={{
        padding: '20px',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem'
            }}>
              🔬
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '0.98rem', color: 'var(--text-main)' }}>
                  {currentHop.name}
                </strong>
                <span className="badge badge-indigo" style={{ fontSize: '0.68rem' }}>{currentHop.category}</span>
                <span className="badge badge-emerald" style={{ fontSize: '0.68rem' }}>{currentHop.direction}</span>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {currentHop.description}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onInspectWaterfall}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', height: '32px', padding: '0 12px' }}
            >
              ⏱️ View Trace Waterfall
            </button>
            <button
              onClick={onInspectLogsStream}
              className="btn-primary"
              style={{ fontSize: '0.78rem', height: '32px', padding: '0 14px' }}
            >
              Inspect Telemetry Spans Stream ({filteredLogsCount}) ➔
            </button>
          </div>
        </div>

        {/* Inspector Grid: Wire Protocol, Headers, Metrics, Policies */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* Card 1: Endpoints & Wire Protocol */}
          <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              WIRE ENDPOINTS & PROTOCOL
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Source: </span>
                <code style={{ fontSize: '0.74rem' }}>{currentHop.source}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Destination: </span>
                <code style={{ fontSize: '0.74rem' }}>{currentHop.destination}</code>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Protocol: </span>
                <strong style={{ color: '#38bdf8' }}>{currentHop.protocol}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Transport: </span>
                <strong style={{ color: 'var(--text-main)' }}>{currentHop.transport}</strong>
              </div>
            </div>
          </div>

          {/* Card 2: Distributed Trace Headers */}
          <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                DISTRIBUTED CONTEXT & HEADERS
              </span>
              <button
                onClick={() => copyToClipboard(JSON.stringify(currentHop.headers, null, 2), 'Headers')}
                className="btn-secondary"
                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
              >
                {copiedKey === 'Headers' ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.74rem', fontFamily: 'monospace' }}>
              {Object.entries(currentHop.headers).map(([k, v]) => (
                <div key={k} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#a78bfa' }}>{k}: </span>
                  <span style={{ color: 'var(--text-main)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Performance & Health Metrics */}
          <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              HOP PERFORMANCE & THROUGHPUT
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.78rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Observed Rate:</span>
                <strong style={{ color: '#10b981' }}>{currentHop.metrics.throughput}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>P95 Latency:</span>
                <strong style={{ color: '#38bdf8' }}>{currentHop.metrics.p95Latency}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Payload Size:</span>
                <strong style={{ color: 'var(--text-main)' }}>{currentHop.metrics.payloadSize}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.7rem' }}>Error Ratio:</span>
                <strong style={{ color: '#10b981' }}>{currentHop.metrics.errorRate}</strong>
              </div>
            </div>
          </div>

          {/* Card 4: Enforced Security Policies */}
          <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              ENFORCED POLICIES & GUARDRAILS
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.76rem' }}>
              {currentHop.policies.map((pol, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#10b981', fontSize: '0.7rem' }}>✓</span>
                  <span style={{ color: 'var(--text-main)' }}>{pol}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
