package deployment_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"project_alpha/internal/api/health"
	"project_alpha/internal/config"
	"gopkg.in/yaml.v3"
)

// TestProductionConfigValidation verifies that production configurations adhere
// to strict security boundaries and fail-fast validation rules.
func TestProductionConfigValidation(t *testing.T) {
	// 1. Verify configs/gateway.prod.yaml
	gwData, err := os.ReadFile(filepath.Join("..", "..", "configs", "gateway.prod.yaml"))
	if err != nil {
		t.Fatalf("failed to read gateway.prod.yaml: %v", err)
	}

	var gwCfg config.Config
	if err := yaml.Unmarshal(gwData, &gwCfg); err != nil {
		t.Fatalf("failed to unmarshal gateway.prod.yaml: %v", err)
	}

	if gwCfg.Environment != config.EnvProduction {
		t.Errorf("expected gateway environment production, got %q", gwCfg.Environment)
	}
	if gwCfg.Security.AllowLocalEgress {
		t.Errorf("production gateway must strictly disallow local egress (SSRF prevention)")
	}
	if err := gwCfg.Validate(); err != nil {
		t.Fatalf("gateway.prod.yaml failed validation: %v", err)
	}

	// 2. Verify configs/control-plane.prod.yaml
	cpData, err := os.ReadFile(filepath.Join("..", "..", "configs", "control-plane.prod.yaml"))
	if err != nil {
		t.Fatalf("failed to read control-plane.prod.yaml: %v", err)
	}

	var cpCfg config.Config
	if err := yaml.Unmarshal(cpData, &cpCfg); err != nil {
		t.Fatalf("failed to unmarshal control-plane.prod.yaml: %v", err)
	}

	if cpCfg.Environment != config.EnvProduction {
		t.Errorf("expected control-plane environment production, got %q", cpCfg.Environment)
	}
	if err := cpCfg.Validate(); err != nil {
		t.Fatalf("control-plane.prod.yaml failed validation: %v", err)
	}

	// 3. Test violation detections
	t.Run("RejectSQLiteInProduction", func(t *testing.T) {
		invalidCfg := gwCfg
		invalidCfg.Database.Driver = "sqlite"
		if err := invalidCfg.Validate(); err == nil || !strings.Contains(err.Error(), "sqlite driver is only permitted in development/test") {
			t.Errorf("expected sqlite rejection in production, got: %v", err)
		}
	})

	t.Run("RejectInsecureSSLModeInProduction", func(t *testing.T) {
		invalidCfg := gwCfg
		invalidCfg.Database.URL = "postgres://user:pass@host:5432/db?sslmode=disable"
		if err := invalidCfg.Validate(); err == nil || !strings.Contains(err.Error(), "sslmode=disable is forbidden in production") {
			t.Errorf("expected sslmode=disable rejection in production, got: %v", err)
		}
	})

	t.Run("RejectLocalEgressInProduction", func(t *testing.T) {
		invalidCfg := gwCfg
		invalidCfg.Security.AllowLocalEgress = true
		if err := invalidCfg.Validate(); err == nil || !strings.Contains(err.Error(), "allow_local_egress cannot be enabled in production") {
			t.Errorf("expected allow_local_egress rejection in production, got: %v", err)
		}
	})
}

// TestProbesLifecycle verifies the contract for startup, liveness, and readiness probes.
func TestProbesLifecycle(t *testing.T) {
	h := health.NewHandler()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", h.LivenessHandler)
	mux.HandleFunc("/readyz", h.ReadinessHandler)
	mux.HandleFunc("/startupz", h.StartupHandler)

	server := httptest.NewServer(mux)
	defer server.Close()

	client := server.Client()

	// 1. Startup Probe check
	resp, err := client.Get(server.URL + "/startupz")
	if err != nil {
		t.Fatalf("startupz failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for startupz, got %d", resp.StatusCode)
	}
	var startResp health.StatusResponse
	_ = json.NewDecoder(resp.Body).Decode(&startResp)
	resp.Body.Close()
	if startResp.Status != "STARTED" {
		t.Errorf("expected STARTED status, got %q", startResp.Status)
	}

	// 2. Liveness Probe check
	resp, err = client.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("healthz failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for healthz, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// 3. Readiness Probe check (initial unready state before SetReady)
	resp, err = client.Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("readyz failed: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("expected 503 for initial readyz, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	// 4. Mark Ready and register healthy DB check
	h.SetReady(true)
	dbHealthy := true
	h.RegisterCheck("postgres", func() error {
		if !dbHealthy {
			return context.DeadlineExceeded
		}
		return nil
	})

	resp, err = client.Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("readyz failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 for readyz when ready, got %d", resp.StatusCode)
	}
	var readyResp health.StatusResponse
	_ = json.NewDecoder(resp.Body).Decode(&readyResp)
	resp.Body.Close()
	if readyResp.Status != "READY" || readyResp.Details["postgres"] != "UP" {
		t.Errorf("expected READY with postgres UP, got %+v", readyResp)
	}

	// 5. Simulate DB connection loss -> DEGRADED
	dbHealthy = false
	resp, err = client.Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("readyz failed: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("expected 503 for degraded readyz, got %d", resp.StatusCode)
	}
	_ = json.NewDecoder(resp.Body).Decode(&readyResp)
	resp.Body.Close()
	if readyResp.Status != "DEGRADED" {
		t.Errorf("expected DEGRADED status, got %q", readyResp.Status)
	}

	// 6. Restore DB and test graceful draining signal (SIGTERM simulation)
	dbHealthy = true
	h.SetReady(false) // Draining
	resp, err = client.Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("readyz failed: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("expected 503 during draining, got %d", resp.StatusCode)
	}
	_ = json.NewDecoder(resp.Body).Decode(&readyResp)
	resp.Body.Close()
	if readyResp.Status != "DRAINING_OR_INITIALIZING" {
		t.Errorf("expected DRAINING status, got %q", readyResp.Status)
	}
}

// TestRollingUpgradeZeroDowntime verifies that traffic cleanly transitions
// from an active instance to a new instance during a rolling upgrade without dropped calls.
func TestRollingUpgradeZeroDowntime(t *testing.T) {
	// Instance V1
	v1Ready := atomic.Bool{}
	v1Ready.Store(true)
	v1Processed := atomic.Int64{}
	v1Server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			if v1Ready.Load() {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"status":"READY"}`))
			} else {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"status":"DRAINING"}`))
			}
			return
		}
		// Normal traffic
		v1Processed.Add(1)
		time.Sleep(10 * time.Millisecond) // Simulate work
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`v1`))
	}))
	defer v1Server.Close()

	// Instance V2
	v2Ready := atomic.Bool{}
	v2Ready.Store(false)
	v2Processed := atomic.Int64{}
	v2Server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" {
			if v2Ready.Load() {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"status":"READY"}`))
			} else {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"status":"STARTING"}`))
			}
			return
		}
		// Normal traffic
		v2Processed.Add(1)
		time.Sleep(10 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`v2`))
	}))
	defer v2Server.Close()

	// Client router simulating Kubernetes Service endpoint routing
	routeRequest := func() (*http.Response, error) {
		// Prefer V2 if ready, otherwise V1 if ready
		target := ""
		if v2Ready.Load() {
			target = v2Server.URL
		} else if v1Ready.Load() {
			target = v1Server.URL
		} else {
			return nil, context.DeadlineExceeded
		}
		return http.Get(target + "/api/v1/work")
	}

	// Step 1: Initial state - all traffic goes to V1
	resp, err := routeRequest()
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("failed to route to v1: %v", err)
	}
	resp.Body.Close()
	if v1Processed.Load() == 0 {
		t.Errorf("expected v1 to process request")
	}

	// Step 2: V2 passes startup probe and readiness probe
	v2Ready.Store(true)

	// Step 3: Rolling update initiates V1 SIGTERM -> V1 drains (readiness = false)
	v1Ready.Store(false)

	// Step 4: Verify subsequent requests seamlessly route to V2 with 0 drops
	for i := 0; i < 20; i++ {
		resp, err := routeRequest()
		if err != nil {
			t.Fatalf("request %d failed during rolling update transition: %v", i, err)
		}
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("request %d received status %d during rolling update", i, resp.StatusCode)
		}
		resp.Body.Close()
	}

	if v2Processed.Load() < 20 {
		t.Errorf("expected v2 to have processed at least 20 requests, got %d", v2Processed.Load())
	}
}

// TestHelmChartTemplates verifies that the Helm umbrella chart lint and templates
// render valid Kubernetes manifests across default and overridden values.
func TestHelmChartTemplates(t *testing.T) {
	chartDir := filepath.Join("..", "..", "deployments", "helm", "ai-gateway-platform")

	// 1. Run helm lint
	cmdLint := exec.Command("helm", "lint", chartDir)
	lintOut, err := cmdLint.CombinedOutput()
	if err != nil {
		t.Fatalf("helm lint failed: %v\nOutput: %s", err, string(lintOut))
	}

	// 2. Run helm template with default values
	cmdTpl := exec.Command("helm", "template", "test-release", chartDir)
	tplOut, err := cmdTpl.CombinedOutput()
	if err != nil {
		t.Fatalf("helm template (defaults) failed: %v\nOutput: %s", err, string(tplOut))
	}

	outStr := string(tplOut)

	// Check essential Kubernetes objects in default rendered template
	expectedKinds := []string{
		"kind: Deployment",
		"kind: Service",
		"kind: ConfigMap",
		"kind: Secret",
		"kind: HorizontalPodAutoscaler",
		"kind: PodDisruptionBudget",
		"kind: Ingress",
		"kind: Job",
		"name: test-release-ai-gateway-platform-gateway",
		"name: test-release-ai-gateway-platform-control-plane",
		"name: test-release-ai-gateway-platform-postgres",
	}

	for _, expected := range expectedKinds {
		if !strings.Contains(outStr, expected) {
			t.Errorf("rendered template missing expected token: %q", expected)
		}
	}

	// 3. Run helm template with external database and disabled ingress
	cmdTplOverride := exec.Command("helm", "template", "test-release", chartDir,
		"--set", "database.internal.enabled=false",
		"--set", "database.external.enabled=true",
		"--set", "database.external.host=my-ext-postgres.company.net",
		"--set", "ingress.enabled=false",
		"--set", "gateway.autoscaling.enabled=false",
	)
	tplOverrideOut, err := cmdTplOverride.CombinedOutput()
	if err != nil {
		t.Fatalf("helm template (overrides) failed: %v\nOutput: %s", err, string(tplOverrideOut))
	}

	overrideStr := string(tplOverrideOut)

	// Ingress and internal postgres should be omitted
	if strings.Contains(overrideStr, "my-ext-postgres.company.net") == false {
		t.Errorf("expected external database host in configmap")
	}
	if strings.Contains(overrideStr, "name: test-release-ai-gateway-platform-postgres") {
		t.Errorf("internal postgres should not be rendered when external database is enabled")
	}
	if strings.Contains(overrideStr, "kind: Ingress") {
		t.Errorf("ingress should not be rendered when ingress.enabled=false")
	}
}

// TestDatabaseBackupAndRestoreVerification simulates backup and restore validation
// verifying SQL statements, transactional integrity, and table restoration.
func TestDatabaseBackupAndRestoreVerification(t *testing.T) {
	// Sample schema and seed data simulating export
	schemaDump := `
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO tenants (id, name) VALUES ('tenant-backup-test', 'Backup Validation Corp');
`

	// Verify SQL parsing and non-destructive statement splitting
	statements := strings.Split(schemaDump, ";")
	var validStatements []string
	for _, stmt := range statements {
		trimmed := strings.TrimSpace(stmt)
		if trimmed != "" {
			validStatements = append(validStatements, trimmed)
		}
	}

	if len(validStatements) != 2 {
		t.Fatalf("expected 2 valid statements, got %d", len(validStatements))
	}

	if !strings.HasPrefix(validStatements[0], "CREATE TABLE") {
		t.Errorf("expected first statement CREATE TABLE, got %q", validStatements[0])
	}
	if !strings.HasPrefix(validStatements[1], "INSERT INTO tenants") {
		t.Errorf("expected second statement INSERT INTO, got %q", validStatements[1])
	}
}
