import {
  ConfiguredTopology,
  ObservedTopology,
  MCPServer,
  Agent,
  TraceSummary,
  TraceDetail,
  LogRecord,
  MetricsSummary,
  A2ATask,
  PolicyRule,
  DryRunRequest,
  DryRunResponse,
  AuditEvent,
  Project,
  UserProfile,
  LoginResponse,
} from '../types';

export class ApiClient {
  private baseUrl: string;
  private tenantId: string;
  private token: string;

  constructor(baseUrl: string = '', tenantId: string = 'tenant-1', token: string = '') {
    this.baseUrl = baseUrl;
    this.tenantId = tenantId;
    this.token = token;
  }

  setTenantId(id: string) {
    this.tenantId = id;
  }

  getTenantId(): string {
    return this.tenantId;
  }

  setToken(token: string) {
    this.token = token;
  }

  getToken(): string {
    return this.token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');

    if (this.tenantId) {
      headers.set('X-Tenant-ID', this.tenantId);
    }
    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const res = await fetch(url, { ...options, headers, credentials: 'include' });
    if (!res.ok) {
      let errMsg = `Request failed: HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {}
      throw new Error(errMsg);
    }
    return res.json();
  }

  // Authentication
  async login(username: string, password: string, tenantId?: string): Promise<LoginResponse> {
    const res = await this.request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, tenant_id: tenantId }),
    });
    if (res.token) {
      this.setToken(res.token);
      if (typeof window !== 'undefined') {
        localStorage.setItem('gateway_token', res.token);
      }
    }
    if (res.user && typeof window !== 'undefined') {
      localStorage.setItem('gateway_user', JSON.stringify(res.user));
    }
    return res;
  }

  async logout(): Promise<{ status: string }> {
    try {
      await this.request<{ status: string }>('/api/v1/auth/logout', {
        method: 'POST',
      });
    } finally {
      this.setToken('');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('gateway_token');
        localStorage.removeItem('gateway_user');
      }
    }
    return { status: 'logged_out' };
  }

  getMe(): Promise<UserProfile> {
    return this.request<UserProfile>('/api/v1/auth/me');
  }

  // Topology
  getConfiguredTopology(): Promise<ConfiguredTopology> {
    return this.request<ConfiguredTopology>('/api/v1/topology/configured');
  }

  getObservedTopology(duration: string = '1h'): Promise<ObservedTopology> {
    return this.request<ObservedTopology>(`/api/v1/topology/observed?duration=${encodeURIComponent(duration)}`);
  }

  // MCP Servers
  listMCPServers(): Promise<MCPServer[]> {
    return this.request<MCPServer[]>('/api/v1/mcp-servers');
  }

  createMCPServer(server: Partial<MCPServer>): Promise<MCPServer> {
    return this.request<MCPServer>('/api/v1/mcp-servers', {
      method: 'POST',
      body: JSON.stringify(server),
    });
  }

  updateMCPServer(id: string, server: Partial<MCPServer>): Promise<MCPServer> {
    return this.request<MCPServer>(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(server),
    });
  }

  deleteMCPServer(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  testMCPHealth(id: string): Promise<{ health: string; message: string; latency_ms: number; http_status: number }> {
    return this.request(`/api/v1/mcp-servers/${encodeURIComponent(id)}/health`, {
      method: 'POST',
    });
  }

  // Agents
  listAgents(): Promise<Agent[]> {
    return this.request<Agent[]>('/api/v1/agents');
  }

  createAgent(agent: Partial<Agent>): Promise<Agent> {
    return this.request<Agent>('/api/v1/agents', {
      method: 'POST',
      body: JSON.stringify(agent),
    });
  }

  updateAgent(id: string, agent: Partial<Agent>): Promise<Agent> {
    return this.request<Agent>(`/api/v1/agents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(agent),
    });
  }

  deleteAgent(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  testAgentHealth(id: string): Promise<{ health: string; message: string; latency_ms: number; http_status: number }> {
    return this.request(`/api/v1/agents/${encodeURIComponent(id)}/health`, {
      method: 'POST',
    });
  }

  // Telemetry & Observability
  listTraces(params: { limit?: number; name?: string; status_code?: string; trace_id?: string } = {}): Promise<TraceSummary[]> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.name) q.set('name', params.name);
    if (params.status_code) q.set('status_code', params.status_code);
    if (params.trace_id) q.set('trace_id', params.trace_id);
    return this.request<TraceSummary[]>(`/api/v1/traces?${q.toString()}`);
  }

  getTrace(id: string): Promise<TraceDetail> {
    return this.request<TraceDetail>(`/api/v1/traces/${encodeURIComponent(id)}`);
  }

  listLogs(params: { limit?: number; trace_id?: string; severity?: string; query?: string } = {}): Promise<LogRecord[]> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.trace_id) q.set('trace_id', params.trace_id);
    if (params.severity) q.set('severity', params.severity);
    if (params.query) q.set('query', params.query);
    return this.request<LogRecord[]>(`/api/v1/logs?${q.toString()}`);
  }

  getMetricsSummary(duration: string = '24h'): Promise<MetricsSummary> {
    return this.request<MetricsSummary>(`/api/v1/metrics/summary?duration=${encodeURIComponent(duration)}`);
  }

  // A2A Tasks & Invocations
  listA2ATasks(params: { limit?: number; status?: string } = {}): Promise<A2ATask[]> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.status) q.set('status', params.status);
    return this.request<A2ATask[]>(`/api/v1/a2a/tasks?${q.toString()}`);
  }

  getA2ATask(id: string): Promise<{ task: A2ATask; events: any[] }> {
    return this.request(`/api/v1/a2a/tasks/${encodeURIComponent(id)}`);
  }

  listMCPInvocations(limit: number = 50): Promise<any[]> {
    return this.request<any[]>(`/api/v1/mcp/invocations?limit=${limit}`);
  }

  // Policies & Dry Run
  listPolicies(): Promise<PolicyRule[]> {
    return this.request<PolicyRule[]>('/api/v1/policies');
  }

  createPolicy(rule: Partial<PolicyRule>): Promise<PolicyRule> {
    return this.request<PolicyRule>('/api/v1/policies', {
      method: 'POST',
      body: JSON.stringify(rule),
    });
  }

  deletePolicy(id: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(`/api/v1/policies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  dryRunPolicy(req: DryRunRequest): Promise<DryRunResponse> {
    return this.request<DryRunResponse>('/api/v1/policies/dry-run', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  // Audit & Projects
  getAudit(params: { limit?: number; action?: string; outcome?: string } = {}): Promise<AuditEvent[]> {
    const q = new URLSearchParams();
    if (params.limit) q.set('limit', String(params.limit));
    if (params.action) q.set('action', params.action);
    if (params.outcome) q.set('outcome', params.outcome);
    return this.request<AuditEvent[]>(`/api/v1/audit?${q.toString()}`);
  }

  listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/api/v1/projects');
  }

  createProject(proj: { name: string; slug: string }): Promise<Project> {
    return this.request<Project>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(proj),
    });
  }
}

export const api = new ApiClient();
