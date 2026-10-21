export interface LogEvent {
  event_id: string;
  timestamp: string;
  project: string;
  mcp_server?: string;
  tool?: string;
  client_id?: string;
  status: string;
  latency_ms: number;
  bytes_in: number;
  bytes_out: number;
  trace_id?: string;
  error?: string;
  attributes?: Record<string, unknown>;
}

export interface GatewayHeartbeat {
  gateway_id: string;
  version: string;
  applied_config_version: number;
  metrics?: Record<string, unknown>;
  timestamp: string;
}
