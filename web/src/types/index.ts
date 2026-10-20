// TypeScript type definitions for the AI Gateway Management & Observability Console

export type NodeStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type NodeType = 'gateway' | 'mcp_server' | 'agent' | 'client' | 'service';
export type Protocol = 'mcp' | 'a2a' | 'http';

export interface TopologyNode {
  id: string;
  label: string;
  type: NodeType;
  status: NodeStatus;
  call_count: number;
  error_count: number;
  avg_latency_ms: number;
  metadata?: Record<string, any>;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  protocol: Protocol;
  call_count: number;
  error_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  last_seen: string;
  sample_trace_ids?: string[];
}

export interface ConfiguredTopology {
  tenant_id: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface ObservedTopology {
  tenant_id: string;
  time_range_start: string;
  time_range_end: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  total_calls: number;
  total_errors: number;
}

export interface MCPServer {
  id: string;
  tenant_id: string;
  name: string;
  namespace_prefix: string;
  transport_type: 'SSE' | 'HTTP_POST' | 'STDIO';
  endpoint_url?: string;
  command?: string;
  auth_header?: string;
  timeout_ms: number;
  concurrency_limit: number;
  health_status: NodeStatus;
  created_at: string;
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  protocol_version: string;
  capabilities: string[];
  input_schema?: any;
  output_schema?: any;
}

export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  endpoint_url: string;
  agent_card: AgentCard;
  protocol_version: string;
  auth_type: string;
  health_status: NodeStatus;
  created_at: string;
}

export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, any>;
}

export interface Span {
  span_id: string;
  trace_id: string;
  parent_span_id?: string;
  tenant_id: string;
  name: string;
  kind: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  status_code: 'OK' | 'ERROR' | 'UNSET';
  status_message?: string;
  attributes?: Record<string, any>;
  events?: SpanEvent[];
}

export interface TraceSummary {
  trace_id: string;
  tenant_id: string;
  root_span_name: string;
  start_time: string;
  duration_ms: number;
  span_count: number;
  status_code: 'OK' | 'ERROR' | 'UNSET';
  status_message?: string;
}

export interface TraceDetail {
  trace_id: string;
  span_count: number;
  spans: Span[];
}

export interface LogRecord {
  id: string;
  tenant_id: string;
  trace_id?: string;
  span_id?: string;
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  message: string;
  attributes?: Record<string, any>;
  timestamp: string;
}

export interface MetricsSummary {
  tenant_id: string;
  time_range_start: string;
  time_range_end: string;
  total_requests: number;
  total_errors: number;
  error_rate_percent: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  active_mcp_servers: number;
  active_agents: number;
  top_tools: Record<string, number>;
  task_status_counts: Record<string, number>;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  seq: number;
  event_type: string;
  payload?: any;
  timestamp: string;
}

export interface A2ATask {
  id: string;
  tenant_id: string;
  caller_client_id: string;
  target_agent_id: string;
  idempotency_key?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
  deadline?: string;
  input_payload: any;
  output_payload?: any;
  error_code?: string;
  error_message?: string;
  trace_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyRule {
  id: string;
  tenant_id: string;
  name: string;
  effect: 'ALLOW' | 'DENY';
  actions: string[];
  resources: string[];
  roles?: string[];
  required_scopes?: string[];
  conditions?: Record<string, any>;
}

export interface DryRunRequest {
  subject: string;
  roles?: string[];
  scopes?: string[];
  action: string;
  resource: string;
  attributes?: Record<string, any>;
}

export interface DryRunResponse {
  decision: 'ALLOW' | 'DENY';
  matched_rule_id?: string;
  matched_rule_name?: string;
  evaluation_reason: string;
  tenant_id: string;
}

export interface AuditEvent {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_id?: string;
  outcome: string;
  client_ip?: string;
  user_agent?: string;
  trace_id?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface Project {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  created_at: string;
}
