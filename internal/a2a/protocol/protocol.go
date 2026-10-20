package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Pinned A2A Protocol Version per ADR-0003.
const ProtocolVersion = "a2a/v1"

// Task lifecycle status states.
const (
	StatusPending   = "PENDING"
	StatusRunning   = "RUNNING"
	StatusCompleted = "COMPLETED"
	StatusFailed    = "FAILED"
	StatusTimedOut  = "TIMED_OUT"
	StatusCancelled = "CANCELLED"
)

// Standard Event Types for streaming task updates.
const (
	EventTypeStatus   = "status"
	EventTypeMessage  = "message"
	EventTypeArtifact = "artifact"
	EventTypeError    = "error"
)

var (
	ErrInvalidAgentCard   = errors.New("invalid agent card specification")
	ErrInvalidTaskStatus  = errors.New("invalid task lifecycle status")
	ErrTaskAlreadyDone    = errors.New("task is already in a terminal state")
	ErrTaskTimeout        = errors.New("task execution deadline exceeded")
	ErrIdempotencyConflict = errors.New("idempotency key conflict: input payload does not match previous execution")
)

// AuthRequirement defines downstream authentication specifications for an agent.
type AuthRequirement struct {
	Type     string   `json:"type"` // "NONE", "STATIC_BEARER", "DELEGATED_TOKEN_EXCHANGE"
	Audience string   `json:"audience,omitempty"`
	Scopes   []string `json:"scopes,omitempty"`
}

// RateLimits defines operational limits announced by the agent.
type RateLimits struct {
	RequestsPerMinute int `json:"requests_per_minute,omitempty"`
	ConcurrencyLimit  int `json:"concurrency_limit,omitempty"`
}

// AgentCard represents the capability specification of an autonomous agent (ADR-0003).
type AgentCard struct {
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	Version         string          `json:"version"`
	ProtocolVersion string          `json:"protocol_version"`
	Capabilities    []string        `json:"capabilities"`
	InputSchema     json.RawMessage `json:"input_schema,omitempty"`
	OutputSchema    json.RawMessage `json:"output_schema,omitempty"`
	Authentication  AuthRequirement `json:"authentication,omitempty"`
	RateLimits      RateLimits      `json:"rate_limits,omitempty"`
	Metadata        map[string]any  `json:"metadata,omitempty"`
}

// Validate checks that mandatory fields of the AgentCard conform to protocol requirements.
func (c *AgentCard) Validate() error {
	if c.Name == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidAgentCard)
	}
	if c.Version == "" {
		return fmt.Errorf("%w: version is required", ErrInvalidAgentCard)
	}
	if c.ProtocolVersion == "" {
		c.ProtocolVersion = ProtocolVersion
	}
	if len(c.Capabilities) == 0 {
		return fmt.Errorf("%w: at least one capability is required", ErrInvalidAgentCard)
	}
	return nil
}

// TaskRequest is the payload submitted by a client to initiate an agent task.
type TaskRequest struct {
	TargetAgentID  string          `json:"target_agent_id"`
	InputPayload   json.RawMessage `json:"input_payload"`
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
	Deadline       *time.Time      `json:"deadline,omitempty"`
}

// TaskResponse is the payload returned by an upstream agent for a task execution.
type TaskResponse struct {
	ID            string          `json:"id"`
	Status        string          `json:"status"`
	OutputPayload json.RawMessage `json:"output_payload,omitempty"`
	ErrorCode     string          `json:"error_code,omitempty"`
	ErrorMessage  string          `json:"error_message,omitempty"`
}

// Task represents a durable A2A task instance.
type Task struct {
	ID             string          `json:"id"`
	TenantID       string          `json:"tenant_id"`
	CallerClientID string          `json:"caller_client_id"`
	TargetAgentID  string          `json:"target_agent_id"`
	IdempotencyKey string          `json:"idempotency_key,omitempty"`
	Status         string          `json:"status"`
	Deadline       *time.Time      `json:"deadline,omitempty"`
	InputPayload   json.RawMessage `json:"input_payload"`
	OutputPayload  json.RawMessage `json:"output_payload,omitempty"`
	ErrorCode      string          `json:"error_code,omitempty"`
	ErrorMessage   string          `json:"error_message,omitempty"`
	TraceID        string          `json:"trace_id,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// IsTerminal returns true if the task has reached a final state.
func (t *Task) IsTerminal() bool {
	return t.Status == StatusCompleted || t.Status == StatusFailed ||
		t.Status == StatusTimedOut || t.Status == StatusCancelled
}

// TaskEvent represents a discrete, ordered milestone event during task execution.
type TaskEvent struct {
	ID          string          `json:"id"`
	TaskID      string          `json:"task_id"`
	TenantID    string          `json:"tenant_id"`
	SequenceNum int             `json:"sequence_num"`
	EventType   string          `json:"event_type"` // status, message, artifact, error
	Payload     json.RawMessage `json:"payload"`
	Timestamp   time.Time       `json:"timestamp"`
}
