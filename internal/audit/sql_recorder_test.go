package audit_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"project_alpha/internal/audit"
	"project_alpha/internal/config"
	"project_alpha/internal/storage"
	"project_alpha/migrations"
)

func TestSQLRecorder_RecordAndQuery(t *testing.T) {
	ctx := context.Background()

	// 1. In-memory SQLite with migrations
	db, err := storage.OpenDB(&config.DatabaseConfig{
		Driver:   "sqlite",
		URL:      ":memory:",
		MaxConns: 1,
	})
	if err != nil {
		t.Fatalf("failed opening test db: %v", err)
	}
	defer db.Close()

	if err := migrations.MigrateUp(ctx, db); err != nil {
		t.Fatalf("failed running migrations: %v", err)
	}

	// Insert parent tenants for foreign key constraint
	_, err = db.ExecContext(ctx, "INSERT INTO tenants (id, name, slug) VALUES ('tenant-alpha', 'Alpha', 'alpha'), ('tenant-beta', 'Beta', 'beta')")
	if err != nil {
		t.Fatalf("failed inserting test tenants: %v", err)
	}

	recorder := audit.NewSQLRecorder(db)

	// 2. Test Record
	now := time.Now().UTC().Truncate(time.Second)
	ev1 := audit.Event{
		TenantID:   "tenant-alpha",
		ActorID:    "user-1",
		ActorType:  audit.ActorTypeUser,
		Action:     audit.ActionPolicyCreate,
		ResourceID: "policy-xyz",
		Outcome:    audit.OutcomeSuccess,
		ClientIP:   "192.168.1.100",
		UserAgent:  "Mozilla/5.0",
		TraceID:    "trace-abc-123",
		Metadata:   map[string]any{"effect": "ALLOW", "role": "admin"},
		Timestamp:  now,
	}

	if err := recorder.Record(ctx, ev1); err != nil {
		t.Fatalf("failed recording audit event: %v", err)
	}

	ev2 := audit.Event{
		TenantID:   "tenant-alpha",
		ActorID:    "user-2",
		ActorType:  audit.ActorTypeUser,
		Action:     audit.ActionServerRegister,
		ResourceID: "srv-99",
		Outcome:    audit.OutcomeSuccess,
		Timestamp:  now.Add(1 * time.Second),
	}
	if err := recorder.Record(ctx, ev2); err != nil {
		t.Fatalf("failed recording second event: %v", err)
	}

	// Event for Tenant Beta (isolation test)
	evBeta := audit.Event{
		TenantID:   "tenant-beta",
		ActorID:    "user-beta",
		ActorType:  audit.ActorTypeUser,
		Action:     audit.ActionPolicyCreate,
		ResourceID: "policy-beta-1",
		Outcome:    audit.OutcomeSuccess,
		Timestamp:  now,
	}
	if err := recorder.Record(ctx, evBeta); err != nil {
		t.Fatalf("failed recording beta event: %v", err)
	}

	// 3. Query Tenant Alpha
	resultsAlpha, err := recorder.Query(ctx, audit.Filter{TenantID: "tenant-alpha"})
	if err != nil {
		t.Fatalf("failed querying alpha events: %v", err)
	}
	if len(resultsAlpha) != 2 {
		t.Fatalf("expected 2 events for alpha, got %d", len(resultsAlpha))
	}

	// Check metadata and fields of first event
	var foundEv1 bool
	for _, res := range resultsAlpha {
		if res.ResourceID == "policy-xyz" {
			foundEv1 = true
			if res.Action != audit.ActionPolicyCreate {
				t.Errorf("wrong action: %s", res.Action)
			}
			if res.Metadata["effect"] != "ALLOW" {
				t.Errorf("metadata effect mismatch: %v", res.Metadata)
			}
		}
	}
	if !foundEv1 {
		t.Errorf("did not find policy-xyz in results")
	}

	// 4. Query with filter by Action
	filtered, err := recorder.Query(ctx, audit.Filter{
		TenantID: "tenant-alpha",
		Action:   audit.ActionServerRegister,
	})
	if err != nil || len(filtered) != 1 {
		t.Fatalf("expected 1 filtered event, got %d (err: %v)", len(filtered), err)
	}
	if filtered[0].ResourceID != "srv-99" {
		t.Errorf("expected srv-99, got %s", filtered[0].ResourceID)
	}

	// 5. Tenant Isolation Check: Beta query must only return beta
	resultsBeta, err := recorder.Query(ctx, audit.Filter{TenantID: "tenant-beta"})
	if err != nil || len(resultsBeta) != 1 {
		t.Fatalf("expected 1 event for beta, got %d (err: %v)", len(resultsBeta), err)
	}
	if resultsBeta[0].ResourceID != "policy-beta-1" {
		t.Errorf("unexpected resource for beta: %s", resultsBeta[0].ResourceID)
	}

	// 6. Fail-closed on missing tenant_id
	_, err = recorder.Query(ctx, audit.Filter{})
	if !errors.Is(err, audit.ErrTenantRequired) {
		t.Errorf("expected ErrTenantRequired, got: %v", err)
	}
}
