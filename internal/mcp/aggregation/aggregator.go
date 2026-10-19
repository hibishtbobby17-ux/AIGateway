package aggregation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"project_alpha/internal/mcp/protocol"
	"project_alpha/internal/mcp/registry"
)

// NamespaceDelimiter separates server prefix from tool/resource name.
const NamespaceDelimiter = "::"

type cachedCatalog struct {
	tools     []protocol.Tool
	resources []protocol.Resource
	prompts   []protocol.Prompt
	expiresAt time.Time
}

// Aggregator aggregates catalogs across multiple upstream MCP servers,
// disambiguates names with server prefixes, and routes tool calls.
type Aggregator struct {
	reg      registry.Registry
	cacheTTL time.Duration

	mu    sync.RWMutex
	cache map[string]*cachedCatalog // key: tenantID
}

// NewAggregator creates an MCP catalog aggregator.
func NewAggregator(reg registry.Registry, cacheTTL time.Duration) *Aggregator {
	if cacheTTL <= 0 {
		cacheTTL = 5 * time.Minute
	}
	return &Aggregator{
		reg:      reg,
		cacheTTL: cacheTTL,
		cache:    make(map[string]*cachedCatalog),
	}
}

// InvalidateCache clears the cached catalog for a tenant.
func (a *Aggregator) InvalidateCache(tenantID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.cache, tenantID)
}

// ListTools retrieves and aggregates tools across all active upstreams for a tenant.
func (a *Aggregator) ListTools(ctx context.Context, tenantID string) (*protocol.ListToolsResult, error) {
	a.mu.RLock()
	cached, ok := a.cache[tenantID]
	if ok && time.Now().Before(cached.expiresAt) {
		tools := cached.tools
		a.mu.RUnlock()
		return &protocol.ListToolsResult{Tools: tools}, nil
	}
	a.mu.RUnlock()

	servers, err := a.reg.ListServers(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("failed listing servers: %w", err)
	}

	var aggregatedTools []protocol.Tool
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, s := range servers {
		if s.Client == nil || s.HealthStatus == "UNHEALTHY" {
			continue
		}

		wg.Add(1)
		go func(srv *registry.ServerRegistration) {
			defer wg.Done()

			callCtx, cancel := context.WithTimeout(ctx, time.Duration(srv.TimeoutMs)*time.Millisecond)
			defer cancel()

			res, err := srv.Client.ListTools(callCtx)
			if err != nil {
				// Log or handle individual upstream error without aborting others
				return
			}

			mu.Lock()
			defer mu.Unlock()
			for _, tool := range res.Tools {
				// Namespace tool: "<server_prefix>::<tool_name>"
				namespacedTool := tool
				namespacedTool.Name = srv.NamespacePrefix + NamespaceDelimiter + tool.Name
				namespacedTool.Description = fmt.Sprintf("[%s] %s", srv.Name, tool.Description)
				aggregatedTools = append(aggregatedTools, namespacedTool)
			}
		}(s)
	}

	wg.Wait()

	// Update cache
	a.mu.Lock()
	a.cache[tenantID] = &cachedCatalog{
		tools:     aggregatedTools,
		expiresAt: time.Now().Add(a.cacheTTL),
	}
	a.mu.Unlock()

	return &protocol.ListToolsResult{Tools: aggregatedTools}, nil
}

// CallTool routes a tool call to its owning upstream server.
func (a *Aggregator) CallTool(ctx context.Context, tenantID, qualifiedName string, args json.RawMessage) (*protocol.CallToolResult, error) {
	parts := strings.SplitN(qualifiedName, NamespaceDelimiter, 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid tool name %q: must specify server prefix as '<server_prefix>::<tool_name>'", qualifiedName)
	}

	serverPrefix := parts[0]
	nativeToolName := parts[1]

	server, err := a.reg.GetServerByName(ctx, tenantID, serverPrefix)
	if err != nil {
		return nil, fmt.Errorf("target upstream server %q not found or not registered for tenant: %w", serverPrefix, err)
	}

	if server.Client == nil {
		return nil, fmt.Errorf("upstream server %q has no active client connection", serverPrefix)
	}

	callCtx, cancel := context.WithTimeout(ctx, time.Duration(server.TimeoutMs)*time.Millisecond)
	defer cancel()

	return server.Client.CallTool(callCtx, nativeToolName, args)
}

// ListResources aggregates resources from all upstream servers for a tenant.
func (a *Aggregator) ListResources(ctx context.Context, tenantID string) (*protocol.ListResourcesResult, error) {
	servers, err := a.reg.ListServers(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	var aggregated []protocol.Resource
	for _, s := range servers {
		if s.Client == nil || s.HealthStatus == "UNHEALTHY" {
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, time.Duration(s.TimeoutMs)*time.Millisecond)
		res, err := s.Client.ListResources(callCtx)
		cancel()
		if err != nil {
			continue
		}
		for _, r := range res.Resources {
			r.Name = s.NamespacePrefix + NamespaceDelimiter + r.Name
			aggregated = append(aggregated, r)
		}
	}
	return &protocol.ListResourcesResult{Resources: aggregated}, nil
}

// ListPrompts aggregates prompts from all upstream servers for a tenant.
func (a *Aggregator) ListPrompts(ctx context.Context, tenantID string) (*protocol.ListPromptsResult, error) {
	servers, err := a.reg.ListServers(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	var aggregated []protocol.Prompt
	for _, s := range servers {
		if s.Client == nil || s.HealthStatus == "UNHEALTHY" {
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, time.Duration(s.TimeoutMs)*time.Millisecond)
		res, err := s.Client.ListPrompts(callCtx)
		cancel()
		if err != nil {
			continue
		}
		for _, p := range res.Prompts {
			p.Name = s.NamespacePrefix + NamespaceDelimiter + p.Name
			aggregated = append(aggregated, p)
		}
	}
	return &protocol.ListPromptsResult{Prompts: aggregated}, nil
}
