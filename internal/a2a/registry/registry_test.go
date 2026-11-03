package registry_test

import (
	"context"
	"testing"

	"AIGateway/internal/a2a/protocol"
	"AIGateway/internal/a2a/registry"
	"AIGateway/internal/config"
	"AIGateway/internal/storage"
	"AIGateway/migrations"
)

func setupTestDB(t *testing.T) *registry.SQLRegistry {
	t.Helper()
	ctx := context.Background()

	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	// Insert parent tenants
	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('tenant-a', 'Tenant A', 'tenant-a'), ('tenant-b', 'Tenant B', 'tenant-b')")
	if err != nil {
		t.Fatalf("failed inserting test tenants: %v", err)
	}

	return registry.NewSQLRegistry(db)
}

func sampleCard() protocol.AgentCard {
	return protocol.AgentCard{
		Name:            "DataAnalyst",
		Description:     "Analyzes customer data and generates summaries",
		Version:         "1.0.0",
		ProtocolVersion: protocol.ProtocolVersion,
		Capabilities:    []string{"data_analysis", "report_generation"},
		Authentication: protocol.AuthRequirement{
			Type: "NONE",
		},
		RateLimits: protocol.RateLimits{
			RequestsPerMinute: 60,
			ConcurrencyLimit:  10,
		},
	}
}

func TestSQLRegistry_RegisterAndRetrieve(t *testing.T) {
	reg := setupTestDB(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-1",
		TenantID:    "tenant-a",
		Name:        "analyst-agent",
		EndpointURL: "http://upstream-analyst:8080/a2a",
		AgentCard:   sampleCard(),
	}

	if err := reg.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("failed to register agent: %v", err)
	}

	// Retrieve by ID
	got, err := reg.GetAgent(ctx, "tenant-a", "agent-1")
	if err != nil {
		t.Fatalf("failed to get agent by id: %v", err)
	}
	if got.Name != "analyst-agent" || got.AgentCard.Name != "DataAnalyst" {
		t.Errorf("unexpected agent data: %+v", got)
	}
	if got.HealthStatus != "HEALTHY" {
		t.Errorf("expected HEALTHY default health status, got %s", got.HealthStatus)
	}

	// Retrieve by Name
	byName, err := reg.GetAgentByName(ctx, "tenant-a", "analyst-agent")
	if err != nil {
		t.Fatalf("failed to get agent by name: %v", err)
	}
	if byName.ID != "agent-1" {
		t.Errorf("expected ID agent-1, got %s", byName.ID)
	}

	// List agents for tenant-a
	list, err := reg.ListAgents(ctx, "tenant-a")
	if err != nil {
		t.Fatalf("failed to list agents: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 agent, got %d", len(list))
	}

	// Verify Tenant Isolation: tenant-b cannot see agent-1
	_, err = reg.GetAgent(ctx, "tenant-b", "agent-1")
	if err != registry.ErrAgentNotFound {
		t.Errorf("expected ErrAgentNotFound for cross-tenant query, got %v", err)
	}
	bList, err := reg.ListAgents(ctx, "tenant-b")
	if err != nil {
		t.Fatalf("failed listing tenant-b: %v", err)
	}
	if len(bList) != 0 {
		t.Errorf("expected 0 agents in tenant-b, got %d", len(bList))
	}
}

func TestSQLRegistry_ValidationAndDuplicate(t *testing.T) {
	reg := setupTestDB(t)
	ctx := context.Background()

	// 1. Invalid agent: missing required fields
	err := reg.RegisterAgent(ctx, &registry.Agent{
		TenantID: "tenant-a",
	})
	if err == nil {
		t.Fatal("expected error on missing name and endpoint")
	}

	// 2. Invalid agent card: missing capabilities
	err = reg.RegisterAgent(ctx, &registry.Agent{
		TenantID:    "tenant-a",
		Name:        "agent-no-caps",
		EndpointURL: "http://example.com",
		AgentCard: protocol.AgentCard{
			Name:    "InvalidCard",
			Version: "1.0",
		},
	})
	if err == nil {
		t.Fatal("expected error on invalid agent card")
	}

	// 3. Register valid agent
	agent1 := &registry.Agent{
		ID:          "agent-dup-1",
		TenantID:    "tenant-a",
		Name:        "researcher",
		EndpointURL: "http://researcher:8080",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agent1); err != nil {
		t.Fatalf("failed registering agent: %v", err)
	}

	// 4. Duplicate name within same tenant should fail
	agent2 := &registry.Agent{
		ID:          "agent-dup-2",
		TenantID:    "tenant-a",
		Name:        "researcher",
		EndpointURL: "http://researcher2:8080",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agent2); err != registry.ErrDuplicateAgentName {
		t.Fatalf("expected ErrDuplicateAgentName, got %v", err)
	}

	// 5. Same name in different tenant should succeed
	agentTenantB := &registry.Agent{
		ID:          "agent-dup-3",
		TenantID:    "tenant-b",
		Name:        "researcher",
		EndpointURL: "http://researcher-b:8080",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agentTenantB); err != nil {
		t.Fatalf("same name in tenant-b should succeed: %v", err)
	}
}

func TestSQLRegistry_UpdateHealthAndDelete(t *testing.T) {
	reg := setupTestDB(t)
	ctx := context.Background()

	agent := &registry.Agent{
		ID:          "agent-lifecycle",
		TenantID:    "tenant-a",
		Name:        "lifecycle-agent",
		EndpointURL: "http://agent:8080",
		AgentCard:   sampleCard(),
	}
	if err := reg.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("failed registering: %v", err)
	}

	// Update health
	if err := reg.UpdateHealth(ctx, "tenant-a", "agent-lifecycle", "UNHEALTHY"); err != nil {
		t.Fatalf("update health failed: %v", err)
	}
	got, _ := reg.GetAgent(ctx, "tenant-a", "agent-lifecycle")
	if got.HealthStatus != "UNHEALTHY" {
		t.Errorf("expected UNHEALTHY, got %s", got.HealthStatus)
	}

	// Cross-tenant update should fail
	if err := reg.UpdateHealth(ctx, "tenant-b", "agent-lifecycle", "HEALTHY"); err != registry.ErrAgentNotFound {
		t.Errorf("expected ErrAgentNotFound on cross-tenant update, got %v", err)
	}

	// Delete agent
	if err := reg.DeleteAgent(ctx, "tenant-a", "agent-lifecycle"); err != nil {
		t.Fatalf("delete agent failed: %v", err)
	}
	_, err := reg.GetAgent(ctx, "tenant-a", "agent-lifecycle")
	if err != registry.ErrAgentNotFound {
		t.Errorf("expected ErrAgentNotFound after deletion, got %v", err)
	}
}

func TestMemoryRegistry_Parity(t *testing.T) {
	ctx := context.Background()
	mem := registry.NewMemoryRegistry()

	agent := &registry.Agent{
		ID:          "mem-1",
		TenantID:    "tenant-a",
		Name:        "mem-agent",
		EndpointURL: "http://mem:8080",
		AgentCard:   sampleCard(),
	}

	if err := mem.RegisterAgent(ctx, agent); err != nil {
		t.Fatalf("mem register failed: %v", err)
	}

	// Duplicate check
	dup := &registry.Agent{
		ID:          "mem-2",
		TenantID:    "tenant-a",
		Name:        "mem-agent",
		EndpointURL: "http://mem2:8080",
		AgentCard:   sampleCard(),
	}
	if err := mem.RegisterAgent(ctx, dup); err != registry.ErrDuplicateAgentName {
		t.Fatalf("expected ErrDuplicateAgentName, got %v", err)
	}

	// Get & List
	got, err := mem.GetAgent(ctx, "tenant-a", "mem-1")
	if err != nil || got.Name != "mem-agent" {
		t.Fatalf("mem get failed: %v", err)
	}

	list, err := mem.ListAgents(ctx, "tenant-a")
	if err != nil || len(list) != 1 {
		t.Fatalf("mem list failed: %v", err)
	}

	// Update health & Delete
	if err := mem.UpdateHealth(ctx, "tenant-a", "mem-1", "DEGRADED"); err != nil {
		t.Fatalf("mem update health failed: %v", err)
	}
	if err := mem.DeleteAgent(ctx, "tenant-a", "mem-1"); err != nil {
		t.Fatalf("mem delete failed: %v", err)
	}
	if _, err := mem.GetAgent(ctx, "tenant-a", "mem-1"); err != registry.ErrAgentNotFound {
		t.Errorf("expected ErrAgentNotFound after delete, got %v", err)
	}
}
