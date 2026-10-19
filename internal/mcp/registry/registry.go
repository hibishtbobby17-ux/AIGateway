package registry

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"project_alpha/internal/mcp/upstream"
)

var (
	ErrServerNotFound      = errors.New("mcp server not found")
	ErrDuplicateServerName = errors.New("mcp server name already registered in tenant")
)

// ServerRegistration holds configuration, health status, and active client handle
// for a registered upstream MCP server.
type ServerRegistration struct {
	ID               string          `json:"id"`
	TenantID         string          `json:"tenant_id"`
	Name             string          `json:"name"`             // Unique slug per tenant (e.g. "github", "postgres")
	NamespacePrefix  string          `json:"namespace_prefix"` // e.g. "github" -> "github::"
	TransportType    string          `json:"transport_type"`   // "SSE", "HTTP_POST", "STDIO"
	EndpointURL      string          `json:"endpoint_url"`
	AuthHeader       string          `json:"auth_header,omitempty"`
	TimeoutMs        int             `json:"timeout_ms"`
	ConcurrencyLimit int             `json:"concurrency_limit"`
	HealthStatus     string          `json:"health_status"` // "HEALTHY", "DEGRADED", "UNHEALTHY"
	CreatedAt        time.Time       `json:"created_at"`
	Client           upstream.Client `json:"-"`
}

// Registry manages upstream server registrations.
type Registry interface {
	RegisterServer(ctx context.Context, s *ServerRegistration) error
	GetServer(ctx context.Context, tenantID, serverID string) (*ServerRegistration, error)
	GetServerByName(ctx context.Context, tenantID, name string) (*ServerRegistration, error)
	ListServers(ctx context.Context, tenantID string) ([]*ServerRegistration, error)
	UpdateHealth(ctx context.Context, tenantID, serverID, status string) error
	RemoveServer(ctx context.Context, tenantID, serverID string) error
}

// MemoryRegistry is an in-memory thread-safe registry.
type MemoryRegistry struct {
	mu      sync.RWMutex
	servers map[string]*ServerRegistration // key: tenantID + ":" + serverID
}

// NewMemoryRegistry creates a new in-memory registry.
func NewMemoryRegistry() *MemoryRegistry {
	return &MemoryRegistry{
		servers: make(map[string]*ServerRegistration),
	}
}

func (r *MemoryRegistry) RegisterServer(ctx context.Context, s *ServerRegistration) error {
	if s == nil {
		return fmt.Errorf("server registration cannot be nil")
	}
	if s.TenantID == "" || s.ID == "" || s.Name == "" {
		return fmt.Errorf("tenant_id, id, and name are required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Check duplicate name within tenant
	for _, existing := range r.servers {
		if existing.TenantID == s.TenantID && existing.Name == s.Name && existing.ID != s.ID {
			return ErrDuplicateServerName
		}
	}

	if s.NamespacePrefix == "" {
		s.NamespacePrefix = s.Name
	}
	if s.CreatedAt.IsZero() {
		s.CreatedAt = time.Now().UTC()
	}
	if s.HealthStatus == "" {
		s.HealthStatus = "HEALTHY"
	}

	key := s.TenantID + ":" + s.ID
	r.servers[key] = s
	return nil
}

func (r *MemoryRegistry) GetServer(ctx context.Context, tenantID, serverID string) (*ServerRegistration, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	key := tenantID + ":" + serverID
	s, ok := r.servers[key]
	if !ok {
		return nil, ErrServerNotFound
	}
	return s, nil
}

func (r *MemoryRegistry) GetServerByName(ctx context.Context, tenantID, name string) (*ServerRegistration, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, s := range r.servers {
		if s.TenantID == tenantID && s.Name == name {
			return s, nil
		}
	}
	return nil, ErrServerNotFound
}

func (r *MemoryRegistry) ListServers(ctx context.Context, tenantID string) ([]*ServerRegistration, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*ServerRegistration
	for _, s := range r.servers {
		if s.TenantID == tenantID {
			result = append(result, s)
		}
	}
	return result, nil
}

func (r *MemoryRegistry) UpdateHealth(ctx context.Context, tenantID, serverID, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	key := tenantID + ":" + serverID
	s, ok := r.servers[key]
	if !ok {
		return ErrServerNotFound
	}
	s.HealthStatus = status
	return nil
}

func (r *MemoryRegistry) RemoveServer(ctx context.Context, tenantID, serverID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	key := tenantID + ":" + serverID
	s, ok := r.servers[key]
	if !ok {
		return ErrServerNotFound
	}
	if s.Client != nil {
		_ = s.Client.Close()
	}
	delete(r.servers, key)
	return nil
}
