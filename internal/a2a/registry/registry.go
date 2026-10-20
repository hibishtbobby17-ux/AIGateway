package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"project_alpha/internal/a2a/protocol"
)

var (
	ErrAgentNotFound      = errors.New("agent not found")
	ErrDuplicateAgentName = errors.New("agent name already registered in tenant")
	ErrInvalidAgent       = errors.New("invalid agent definition")
)

// Agent represents an autonomous agent registration.
type Agent struct {
	ID                       string             `json:"id"`
	TenantID                 string             `json:"tenant_id"`
	ProjectID                *string            `json:"project_id,omitempty"`
	Name                     string             `json:"name"`
	EndpointURL              string             `json:"endpoint_url"`
	AgentCard                protocol.AgentCard `json:"agent_card"`
	ProtocolVersion          string             `json:"protocol_version"`
	AuthType                 string             `json:"auth_type"` // NONE, STATIC_BEARER, DELEGATED_TOKEN_EXCHANGE
	EncryptedAuthCredentials []byte             `json:"-"`
	HealthStatus             string             `json:"health_status"` // HEALTHY, UNHEALTHY, UNKNOWN
	CreatedAt                time.Time          `json:"created_at"`
}

// Registry defines operations for managing agent registrations.
type Registry interface {
	RegisterAgent(ctx context.Context, agent *Agent) error
	GetAgent(ctx context.Context, tenantID, agentID string) (*Agent, error)
	GetAgentByName(ctx context.Context, tenantID, name string) (*Agent, error)
	ListAgents(ctx context.Context, tenantID string) ([]*Agent, error)
	UpdateHealth(ctx context.Context, tenantID, agentID, status string) error
	DeleteAgent(ctx context.Context, tenantID, agentID string) error
}

// SQLRegistry implements Registry backed by a relational database (PostgreSQL or SQLite).
type SQLRegistry struct {
	db *sql.DB
}

// NewSQLRegistry creates a new SQLRegistry.
func NewSQLRegistry(db *sql.DB) *SQLRegistry {
	return &SQLRegistry{db: db}
}

func (r *SQLRegistry) RegisterAgent(ctx context.Context, agent *Agent) error {
	if agent == nil {
		return ErrInvalidAgent
	}
	if strings.TrimSpace(agent.TenantID) == "" || strings.TrimSpace(agent.Name) == "" || strings.TrimSpace(agent.EndpointURL) == "" {
		return fmt.Errorf("%w: tenant_id, name, and endpoint_url are required", ErrInvalidAgent)
	}
	if err := agent.AgentCard.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAgent, err)
	}
	if agent.ID == "" {
		agent.ID = uuid.NewString()
	}
	if agent.ProtocolVersion == "" {
		agent.ProtocolVersion = protocol.ProtocolVersion
	}
	if agent.AuthType == "" {
		agent.AuthType = "NONE"
	}
	if agent.HealthStatus == "" {
		agent.HealthStatus = "HEALTHY"
	}
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = time.Now().UTC()
	}

	cardBytes, err := json.Marshal(agent.AgentCard)
	if err != nil {
		return fmt.Errorf("failed to marshal agent card: %w", err)
	}

	query := `
		INSERT INTO agents (
			id, tenant_id, project_id, name, endpoint_url,
			agent_card, protocol_version, auth_type, encrypted_auth_credentials,
			health_status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err = r.db.ExecContext(ctx, query,
		agent.ID,
		agent.TenantID,
		agent.ProjectID,
		agent.Name,
		agent.EndpointURL,
		string(cardBytes),
		agent.ProtocolVersion,
		agent.AuthType,
		agent.EncryptedAuthCredentials,
		agent.HealthStatus,
		agent.CreatedAt,
	)
	if err != nil {
		lower := strings.ToLower(err.Error())
		if strings.Contains(lower, "unique") || strings.Contains(lower, "duplicate") {
			return ErrDuplicateAgentName
		}
		return fmt.Errorf("failed to register agent: %w", err)
	}
	return nil
}

func (r *SQLRegistry) GetAgent(ctx context.Context, tenantID, agentID string) (*Agent, error) {
	if tenantID == "" || agentID == "" {
		return nil, ErrAgentNotFound
	}
	query := `
		SELECT id, tenant_id, project_id, name, endpoint_url,
		       agent_card, protocol_version, auth_type, encrypted_auth_credentials,
		       health_status, created_at
		FROM agents
		WHERE tenant_id = $1 AND id = $2
	`
	row := r.db.QueryRowContext(ctx, query, tenantID, agentID)
	return scanAgent(row)
}

func (r *SQLRegistry) GetAgentByName(ctx context.Context, tenantID, name string) (*Agent, error) {
	if tenantID == "" || name == "" {
		return nil, ErrAgentNotFound
	}
	query := `
		SELECT id, tenant_id, project_id, name, endpoint_url,
		       agent_card, protocol_version, auth_type, encrypted_auth_credentials,
		       health_status, created_at
		FROM agents
		WHERE tenant_id = $1 AND name = $2
	`
	row := r.db.QueryRowContext(ctx, query, tenantID, name)
	return scanAgent(row)
}

func (r *SQLRegistry) ListAgents(ctx context.Context, tenantID string) ([]*Agent, error) {
	if tenantID == "" {
		return nil, nil
	}
	query := `
		SELECT id, tenant_id, project_id, name, endpoint_url,
		       agent_card, protocol_version, auth_type, encrypted_auth_credentials,
		       health_status, created_at
		FROM agents
		WHERE tenant_id = $1
		ORDER BY created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to list agents: %w", err)
	}
	defer rows.Close()

	var agents []*Agent
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error reading agent rows: %w", err)
	}
	return agents, nil
}

func (r *SQLRegistry) UpdateHealth(ctx context.Context, tenantID, agentID, status string) error {
	if tenantID == "" || agentID == "" {
		return ErrAgentNotFound
	}
	query := `
		UPDATE agents
		SET health_status = $1
		WHERE tenant_id = $2 AND id = $3
	`
	res, err := r.db.ExecContext(ctx, query, status, tenantID, agentID)
	if err != nil {
		return fmt.Errorf("failed to update agent health: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if n == 0 {
		return ErrAgentNotFound
	}
	return nil
}

func (r *SQLRegistry) DeleteAgent(ctx context.Context, tenantID, agentID string) error {
	if tenantID == "" || agentID == "" {
		return ErrAgentNotFound
	}
	query := `
		DELETE FROM agents
		WHERE tenant_id = $1 AND id = $2
	`
	res, err := r.db.ExecContext(ctx, query, tenantID, agentID)
	if err != nil {
		return fmt.Errorf("failed to delete agent: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}
	if n == 0 {
		return ErrAgentNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanAgent(s rowScanner) (*Agent, error) {
	var a Agent
	var projectID sql.NullString
	var cardJSON string
	var creds []byte

	err := s.Scan(
		&a.ID,
		&a.TenantID,
		&projectID,
		&a.Name,
		&a.EndpointURL,
		&cardJSON,
		&a.ProtocolVersion,
		&a.AuthType,
		&creds,
		&a.HealthStatus,
		&a.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAgentNotFound
		}
		return nil, fmt.Errorf("failed to scan agent: %w", err)
	}

	if projectID.Valid {
		a.ProjectID = &projectID.String
	}
	a.EncryptedAuthCredentials = creds

	if err := json.Unmarshal([]byte(cardJSON), &a.AgentCard); err != nil {
		return nil, fmt.Errorf("failed to unmarshal agent card: %w", err)
	}

	return &a, nil
}

// MemoryRegistry is an in-memory thread-safe registry.
type MemoryRegistry struct {
	mu     sync.RWMutex
	agents map[string]*Agent // key: tenantID + ":" + agentID
}

// NewMemoryRegistry creates a new in-memory registry.
func NewMemoryRegistry() *MemoryRegistry {
	return &MemoryRegistry{
		agents: make(map[string]*Agent),
	}
}

func (m *MemoryRegistry) RegisterAgent(ctx context.Context, agent *Agent) error {
	if agent == nil {
		return ErrInvalidAgent
	}
	if strings.TrimSpace(agent.TenantID) == "" || strings.TrimSpace(agent.Name) == "" || strings.TrimSpace(agent.EndpointURL) == "" {
		return fmt.Errorf("%w: tenant_id, name, and endpoint_url are required", ErrInvalidAgent)
	}
	if err := agent.AgentCard.Validate(); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidAgent, err)
	}
	if agent.ID == "" {
		agent.ID = uuid.NewString()
	}
	if agent.ProtocolVersion == "" {
		agent.ProtocolVersion = protocol.ProtocolVersion
	}
	if agent.AuthType == "" {
		agent.AuthType = "NONE"
	}
	if agent.HealthStatus == "" {
		agent.HealthStatus = "HEALTHY"
	}
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = time.Now().UTC()
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, existing := range m.agents {
		if existing.TenantID == agent.TenantID && existing.Name == agent.Name && existing.ID != agent.ID {
			return ErrDuplicateAgentName
		}
	}

	key := agent.TenantID + ":" + agent.ID
	m.agents[key] = agent
	return nil
}

func (m *MemoryRegistry) GetAgent(ctx context.Context, tenantID, agentID string) (*Agent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := tenantID + ":" + agentID
	a, ok := m.agents[key]
	if !ok {
		return nil, ErrAgentNotFound
	}
	return a, nil
}

func (m *MemoryRegistry) GetAgentByName(ctx context.Context, tenantID, name string) (*Agent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, a := range m.agents {
		if a.TenantID == tenantID && a.Name == name {
			return a, nil
		}
	}
	return nil, ErrAgentNotFound
}

func (m *MemoryRegistry) ListAgents(ctx context.Context, tenantID string) ([]*Agent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Agent
	for _, a := range m.agents {
		if a.TenantID == tenantID {
			result = append(result, a)
		}
	}
	return result, nil
}

func (m *MemoryRegistry) UpdateHealth(ctx context.Context, tenantID, agentID, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := tenantID + ":" + agentID
	a, ok := m.agents[key]
	if !ok {
		return ErrAgentNotFound
	}
	a.HealthStatus = status
	return nil
}

func (m *MemoryRegistry) DeleteAgent(ctx context.Context, tenantID, agentID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := tenantID + ":" + agentID
	if _, ok := m.agents[key]; !ok {
		return ErrAgentNotFound
	}
	delete(m.agents, key)
	return nil
}
