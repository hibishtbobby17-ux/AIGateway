package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	a2aprotocol "AIGateway/internal/a2a/protocol"
	a2aregistry "AIGateway/internal/a2a/registry"
	"AIGateway/internal/config"
	"AIGateway/internal/identity/idp"
	"AIGateway/internal/identity/keys"
	"AIGateway/internal/identity/tokens"
	mcpregistry "AIGateway/internal/mcp/registry"
	"AIGateway/internal/storage"
	"AIGateway/internal/tenants"
	"AIGateway/migrations"
)

const defaultDevEncryptionKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func main() {
	fmt.Println("==================================================================")
	fmt.Println(" AI Gateway & Control Plane - Local Development Seed & Setup Tool")
	fmt.Println("==================================================================")

	cfg := config.NewDefaultConfig()
	cfg.LoadFromEnv()

	// Apply safe development defaults if not set in environment
	if os.Getenv("GATEWAY_DATABASE_DRIVER") == "" && os.Getenv("GATEWAY_DATABASE_URL") == "" {
		cfg.Database.Driver = "sqlite"
		cfg.Database.URL = "gateway.db"
	}
	if cfg.Security.SigningKeyEncryptionKeyHex == "" {
		cfg.Security.SigningKeyEncryptionKeyHex = defaultDevEncryptionKey
	}

	fmt.Printf("[+] Database: %s (%s)\n", cfg.Database.Driver, cfg.Database.URL)

	db, err := storage.OpenDB(&cfg.Database)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1. Run migrations
	fmt.Println("[+] Applying database schema migrations...")
	if err := migrations.MigrateUp(ctx, db); err != nil {
		fmt.Fprintf(os.Stderr, "[-] Migrations failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("[+] Schema is up-to-date.")

	// 2. Ensure default tenants exist
	tenantsRepo := storage.NewSQLTenantRepository(db)
	tenantID := "tenant-1"
	t1, err := tenantsRepo.GetTenantByID(ctx, tenantID)
	if err != nil || t1 == nil {
		fmt.Println("[+] Provisioning default tenant: tenant-1 (Acme AI Labs)...")
		_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
			ID:     tenantID,
			Name:   "Acme AI Labs",
			Slug:   "acme-ai",
			Status: "ACTIVE",
			Tier:   "enterprise",
		})
	}
	_ = tenantsRepo.CreateTenant(ctx, &tenants.Tenant{
		ID:     "tenant-2",
		Name:   "Beta Research Group",
		Slug:   "beta-research",
		Status: "ACTIVE",
		Tier:   "standard",
	})

	// Ensure default administrator user account exists
	userRepo, _ := idp.NewSQLUserRepository(db, 10)
	if userRepo != nil {
		if _, err := userRepo.GetUserByUsername(ctx, tenantID, "admin"); errors.Is(err, idp.ErrUserNotFound) {
			_ = userRepo.CreateUser(ctx, &idp.User{
				TenantID: tenantID,
				Username: "admin",
				Email:    "admin@gateway.local",
				Roles:    []string{"platform-admin", "tenant-admin", "auditor"},
				Active:   true,
			}, "admin123")
			fmt.Println("[+] Provisioned default console administrator: admin / admin123")
		}
	}

	// 3. Ensure sample MCP server exists
	mcpReg := mcpregistry.NewSQLRegistry(db)
	servers, _ := mcpReg.ListServers(ctx, tenantID)
	if len(servers) == 0 {
		fmt.Println("[+] Provisioning sample MCP server (filesystem-tools)...")
		_ = mcpReg.RegisterServer(ctx, &mcpregistry.ServerRegistration{
			ID:              "mcp-fs-01",
			TenantID:        tenantID,
			Name:            "filesystem-tools",
			NamespacePrefix: "fs",
			TransportType:   "SSE",
			EndpointURL:     "http://localhost:8082/sse",
			HealthStatus:    "HEALTHY",
			TimeoutMs:       5000,
		})
	}

	// 4. Ensure sample A2A agent exists
	a2aReg := a2aregistry.NewSQLRegistry(db)
	agents, _ := a2aReg.ListAgents(ctx, tenantID)
	if len(agents) == 0 {
		fmt.Println("[+] Provisioning sample A2A agent (analyst-agent)...")
		agentCard := a2aprotocol.AgentCard{
			Name:            "Data Analysis Agent",
			Description:     "Autonomous data analysis and synthesis assistant",
			Version:         "1.0.0",
			ProtocolVersion: a2aprotocol.ProtocolVersion,
			Capabilities:    []string{"data_analysis", "chart_generation", "summarization"},
		}
		_ = a2aReg.RegisterAgent(ctx, &a2aregistry.Agent{
			ID:           "agent-analyst-01",
			TenantID:     tenantID,
			Name:         "analyst-agent",
			EndpointURL:  "http://localhost:8083/a2a",
			AgentCard:    agentCard,
			HealthStatus: "HEALTHY",
			AuthType:     "NONE",
		})
	}

	// 5. Initialize signing key manager & mint admin JWT
	keyEncryptionKey, err := cfg.SigningKeyEncryptionKey()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Invalid signing key encryption key: %v\n", err)
		os.Exit(1)
	}

	keyRepo, err := keys.NewSQLRepository(db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Failed to init signing key repo: %v\n", err)
		os.Exit(1)
	}

	keyManager, err := keys.NewPersistentManager(ctx, keyRepo, keyEncryptionKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Failed to init persistent key manager: %v\n", err)
		os.Exit(1)
	}

	activeKey, err := keyManager.GetActiveKey()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Failed to get active key: %v\n", err)
		os.Exit(1)
	}

	now := time.Now().UTC()
	claims := &tokens.Claims{
		Issuer:    cfg.Security.JWTIssuer,
		Subject:   "admin-local",
		Audience:  cfg.Security.JWTAudience,
		TenantID:  tenantID,
		Roles:     []string{"platform-admin", "tenant-admin", "auditor"},
		Scopes:    []string{"admin:read", "admin:write", "mcp:all", "a2a:all"},
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(30 * 24 * time.Hour).Unix(), // Valid for 30 days
		TokenID:   uuid.NewString(),
	}

	tokenString, err := tokens.Sign(claims, activeKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[-] Failed to sign developer token: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\n==================================================================")
	fmt.Println(" [SUCCESS] Local Environment Initialized & Ready")
	fmt.Println("==================================================================")
	fmt.Printf(" Active Tenant ID : %s\n", tenantID)
	fmt.Printf(" Roles            : platform-admin, tenant-admin, auditor\n")
	fmt.Printf(" Token Expiration : 30 days\n")
	fmt.Println("------------------------------------------------------------------")
	fmt.Println(" AUTHENTICATION TOKEN (Copy & Paste into Console Modal or Header):")
	fmt.Printf("%s\n", tokenString)
	fmt.Println("------------------------------------------------------------------")
	fmt.Println("\n To start the services in separate terminal windows:")
	fmt.Println(" 1. Control Plane (Console & Admin APIs on Port 8081):")
	fmt.Printf("    $env:GATEWAY_DATABASE_DRIVER=\"sqlite\"; $env:GATEWAY_DATABASE_URL=\"%s\"; $env:GATEWAY_SIGNING_KEY_ENCRYPTION_KEY=\"%s\"; go run ./cmd/control-plane\n\n", cfg.Database.URL, cfg.Security.SigningKeyEncryptionKeyHex)
	fmt.Println(" 2. Gateway Proxy (MCP & A2A Traffic on Port 8080):")
	fmt.Printf("    $env:GATEWAY_DATABASE_DRIVER=\"sqlite\"; $env:GATEWAY_DATABASE_URL=\"%s\"; $env:GATEWAY_SIGNING_KEY_ENCRYPTION_KEY=\"%s\"; go run ./cmd/gateway\n\n", cfg.Database.URL, cfg.Security.SigningKeyEncryptionKeyHex)
	fmt.Println(" 3. Open in Browser:")
	fmt.Println("    Management Console: http://localhost:8081/console/")
	fmt.Println("==================================================================")

	// Save token and quickstart info to local dev-token.json for easy access
	devInfo := map[string]string{
		"tenant_id": tenantID,
		"token":     tokenString,
		"issued_at": now.Format(time.RFC3339),
	}
	devJSON, _ := json.MarshalIndent(devInfo, "", "  ")
	_ = os.WriteFile("dev-token.json", devJSON, 0600)
	fmt.Println(" [INFO] Credentials also saved to dev-token.json for quick reference.")
}
