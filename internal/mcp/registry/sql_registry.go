package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"AIGateway/internal/identity/delegation"
)

// SQLRegistry implements Registry backed by SQLite or PostgreSQL.
type SQLRegistry struct {
	db *sql.DB
}

// NewSQLRegistry creates a new SQLRegistry.
func NewSQLRegistry(db *sql.DB) *SQLRegistry {
	return &SQLRegistry{db: db}
}

func (r *SQLRegistry) RegisterServer(ctx context.Context, s *ServerRegistration) error {
	if s == nil {
		return errors.New("server registration cannot be nil")
	}
	if strings.TrimSpace(s.TenantID) == "" || strings.TrimSpace(s.Name) == "" {
		return errors.New("tenant_id and name are required")
	}
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	if s.NamespacePrefix == "" {
		s.NamespacePrefix = s.Name
	}
	if s.TransportType == "" {
		s.TransportType = "SSE"
	}
	if s.HealthStatus == "" {
		s.HealthStatus = "UNKNOWN"
	}
	if s.TimeoutMs <= 0 {
		s.TimeoutMs = 10000
	}
	if s.ConcurrencyLimit <= 0 {
		s.ConcurrencyLimit = 50
	}
	if s.CreatedAt.IsZero() {
		s.CreatedAt = time.Now().UTC()
	}

	authType := s.AuthConfig.Type
	if authType == "" {
		authType = "NONE"
	}

	var authCreds []byte
	if s.AuthHeader != "" || s.AuthConfig.Type != "" {
		credData := map[string]any{
			"auth_header": s.AuthHeader,
			"auth_config": s.AuthConfig,
		}
		authCreds, _ = json.Marshal(credData)
	}

	query := `
		INSERT INTO mcp_servers (
			id, tenant_id, project_id, name, namespace_prefix,
			transport_type, endpoint_url, command, auth_type,
			encrypted_auth_credentials, timeout_ms, concurrency_limit,
			health_status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`
	_, err := r.db.ExecContext(ctx, query,
		s.ID,
		s.TenantID,
		s.ProjectID,
		s.Name,
		s.NamespacePrefix,
		s.TransportType,
		s.EndpointURL,
		s.Command,
		authType,
		authCreds,
		s.TimeoutMs,
		s.ConcurrencyLimit,
		s.HealthStatus,
		s.CreatedAt,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrDuplicateServerName
		}
		return fmt.Errorf("failed to register mcp server: %w", err)
	}
	return nil
}

func (r *SQLRegistry) GetServer(ctx context.Context, tenantID, serverID string) (*ServerRegistration, error) {
	if tenantID == "" || serverID == "" {
		return nil, ErrServerNotFound
	}

	query := `
		SELECT id, tenant_id, project_id, name, namespace_prefix,
		       transport_type, endpoint_url, command, auth_type,
		       encrypted_auth_credentials, timeout_ms, concurrency_limit,
		       health_status, created_at
		FROM mcp_servers
		WHERE tenant_id = $1 AND id = $2
	`
	row := r.db.QueryRowContext(ctx, query, tenantID, serverID)
	return scanServer(row)
}

func (r *SQLRegistry) GetServerByName(ctx context.Context, tenantID, name string) (*ServerRegistration, error) {
	if tenantID == "" || name == "" {
		return nil, ErrServerNotFound
	}

	query := `
		SELECT id, tenant_id, project_id, name, namespace_prefix,
		       transport_type, endpoint_url, command, auth_type,
		       encrypted_auth_credentials, timeout_ms, concurrency_limit,
		       health_status, created_at
		FROM mcp_servers
		WHERE tenant_id = $1 AND name = $2
	`
	row := r.db.QueryRowContext(ctx, query, tenantID, name)
	return scanServer(row)
}

func (r *SQLRegistry) ListServers(ctx context.Context, tenantID string) ([]*ServerRegistration, error) {
	if tenantID == "" {
		return nil, nil
	}

	query := `
		SELECT id, tenant_id, project_id, name, namespace_prefix,
		       transport_type, endpoint_url, command, auth_type,
		       encrypted_auth_credentials, timeout_ms, concurrency_limit,
		       health_status, created_at
		FROM mcp_servers
		WHERE tenant_id = $1
		ORDER BY name ASC
	`
	rows, err := r.db.QueryContext(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed to list mcp servers: %w", err)
	}
	defer rows.Close()

	var servers []*ServerRegistration
	for rows.Next() {
		s, err := scanServer(rows)
		if err != nil {
			return nil, err
		}
		servers = append(servers, s)
	}
	return servers, rows.Err()
}

func (r *SQLRegistry) UpdateHealth(ctx context.Context, tenantID, serverID, status string) error {
	if tenantID == "" || serverID == "" {
		return ErrServerNotFound
	}

	query := `
		UPDATE mcp_servers
		SET health_status = $1
		WHERE tenant_id = $2 AND id = $3
	`
	res, err := r.db.ExecContext(ctx, query, status, tenantID, serverID)
	if err != nil {
		return fmt.Errorf("failed to update mcp server health: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check rows affected: %w", err)
	}
	if n == 0 {
		return ErrServerNotFound
	}
	return nil
}

func (r *SQLRegistry) UpdateServer(ctx context.Context, s *ServerRegistration) error {
	if s == nil || s.TenantID == "" || s.ID == "" {
		return fmt.Errorf("tenant_id and id are required")
	}

	authType := s.AuthConfig.Type
	if authType == "" {
		authType = "NONE"
	}
	var authCreds []byte
	if s.AuthHeader != "" || s.AuthConfig.Type != "" {
		credData := map[string]any{
			"auth_header": s.AuthHeader,
			"auth_config": s.AuthConfig,
		}
		authCreds, _ = json.Marshal(credData)
	}

	query := `
		UPDATE mcp_servers
		SET project_id = $1, name = $2, namespace_prefix = $3,
		    transport_type = $4, endpoint_url = $5, command = $6,
		    auth_type = $7, encrypted_auth_credentials = $8,
		    timeout_ms = $9, concurrency_limit = $10, health_status = $11
		WHERE tenant_id = $12 AND id = $13
	`
	res, err := r.db.ExecContext(ctx, query,
		s.ProjectID,
		s.Name,
		s.NamespacePrefix,
		s.TransportType,
		s.EndpointURL,
		s.Command,
		authType,
		authCreds,
		s.TimeoutMs,
		s.ConcurrencyLimit,
		s.HealthStatus,
		s.TenantID,
		s.ID,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return ErrDuplicateServerName
		}
		return fmt.Errorf("failed to update mcp server: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check rows affected: %w", err)
	}
	if n == 0 {
		return ErrServerNotFound
	}
	return nil
}

func (r *SQLRegistry) RemoveServer(ctx context.Context, tenantID, serverID string) error {
	if tenantID == "" || serverID == "" {
		return ErrServerNotFound
	}

	query := `
		DELETE FROM mcp_servers
		WHERE tenant_id = $1 AND id = $2
	`
	res, err := r.db.ExecContext(ctx, query, tenantID, serverID)
	if err != nil {
		return fmt.Errorf("failed to delete mcp server: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check rows affected: %w", err)
	}
	if n == 0 {
		return ErrServerNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanServer(s rowScanner) (*ServerRegistration, error) {
	var reg ServerRegistration
	var projectID sql.NullString
	var endpointURL, command sql.NullString
	var authType string
	var creds []byte

	err := s.Scan(
		&reg.ID,
		&reg.TenantID,
		&projectID,
		&reg.Name,
		&reg.NamespacePrefix,
		&reg.TransportType,
		&endpointURL,
		&command,
		&authType,
		&creds,
		&reg.TimeoutMs,
		&reg.ConcurrencyLimit,
		&reg.HealthStatus,
		&reg.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrServerNotFound
		}
		return nil, fmt.Errorf("failed to scan mcp server: %w", err)
	}

	if projectID.Valid {
		reg.ProjectID = &projectID.String
	}
	if endpointURL.Valid {
		reg.EndpointURL = endpointURL.String
	}
	if command.Valid {
		reg.Command = command.String
	}

	if len(creds) > 0 {
		var credData struct {
			AuthHeader string                        `json:"auth_header"`
			AuthConfig delegation.UpstreamAuthConfig `json:"auth_config"`
		}
		if err := json.Unmarshal(creds, &credData); err == nil {
			reg.AuthHeader = credData.AuthHeader
			reg.AuthConfig = credData.AuthConfig
		}
	}

	return &reg, nil
}
