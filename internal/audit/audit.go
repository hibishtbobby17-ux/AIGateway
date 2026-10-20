package audit

import (
	"context"
	"time"
)

const (
	ActorTypeUser   = "USER"
	ActorTypeAgent  = "AGENT"
	ActorTypeSystem = "SYSTEM"
	ActorTypeClient = "CLIENT"

	OutcomeSuccess = "SUCCESS"
	OutcomeFailure = "FAILURE"
	OutcomeDenied  = "DENIED"

	ActionPolicyCreate   = "admin.policy.create"
	ActionPolicyDelete   = "admin.policy.delete"
	ActionServerRegister = "admin.server.register"
	ActionServerRemove   = "admin.server.remove"
	ActionAgentRegister  = "admin.agent.register"
	ActionAgentRemove    = "admin.agent.remove"
	ActionTokenRevoke    = "oauth.token.revoke"
	ActionAccessDenied   = "security.access_denied"
	ActionTenantCreate   = "admin.tenant.create"
	ActionA2ATaskSubmit  = "a2a.task.submit"
	ActionA2ATaskCancel  = "a2a.task.cancel"
)

// Event represents an immutable security or administrative audit log entry.
type Event struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id"`
	ActorID    string         `json:"actor_id"`
	ActorType  string         `json:"actor_type"`
	Action     string         `json:"action"`
	ResourceID string         `json:"resource_id,omitempty"`
	Outcome    string         `json:"outcome"`
	ClientIP   string         `json:"client_ip,omitempty"`
	UserAgent  string         `json:"user_agent,omitempty"`
	TraceID    string         `json:"trace_id,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	Timestamp  time.Time      `json:"timestamp"`
}

// Filter defines search criteria for audit event queries with tenant scoping.
type Filter struct {
	TenantID  string
	ActorID   string
	Action    string
	Outcome   string
	StartTime time.Time
	EndTime   time.Time
	Limit     int
}

// Recorder records and queries audit events.
type Recorder interface {
	Record(ctx context.Context, event Event) error
	Query(ctx context.Context, filter Filter) ([]Event, error)
}
