package events

// LogEvent represents a structured log event emitted by the AI Gateway
// and ingested by the Ingest service.
type LogEvent struct {
	EventID     string                 `json:"event_id"`
	Timestamp   string                 `json:"timestamp"`
	Project     string                 `json:"project"`
	MCPServer   string                 `json:"mcp_server,omitempty"`
	Tool        string                 `json:"tool,omitempty"`
	ClientID    string                 `json:"client_id,omitempty"`
	Status      string                 `json:"status"`
	LatencyMs   float64                `json:"latency_ms"`
	BytesIn     int64                  `json:"bytes_in"`
	BytesOut    int64                  `json:"bytes_out"`
	TraceID     string                 `json:"trace_id,omitempty"`
	Error       string                 `json:"error,omitempty"`
	Attributes  map[string]interface{} `json:"attributes,omitempty"`
}

// GatewayHeartbeat represents the heartbeat sent by headless gateways to the console.
type GatewayHeartbeat struct {
	GatewayID            string                 `json:"gateway_id"`
	Version              string                 `json:"version"`
	AppliedConfigVersion int                    `json:"applied_config_version"`
	Metrics              map[string]interface{} `json:"metrics,omitempty"`
	Timestamp            string                 `json:"timestamp"`
}
