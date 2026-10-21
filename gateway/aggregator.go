package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

type toolCacheEntry struct {
	tools     []MCPTool
	warnings  []string
	version   int
	createdAt time.Time
}

type MCPAggregator struct {
	pool      *DownstreamPool
	logger    *slog.Logger
	cacheMu   sync.RWMutex
	toolCache map[string]toolCacheEntry // key: project slug
}

func NewMCPAggregator(pool *DownstreamPool, logger *slog.Logger) *MCPAggregator {
	if logger == nil {
		logger = slog.Default()
	}
	return &MCPAggregator{
		pool:      pool,
		logger:    logger,
		toolCache: make(map[string]toolCacheEntry),
	}
}

// HandleInitialize responds with aggregated server capabilities and project info
func (a *MCPAggregator) HandleInitialize(req *JSONRPCRequest, proj *Project) *JSONRPCResponse {
	return NewJSONRPCResponse(req.ID, map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities": map[string]interface{}{
			"tools":     map[string]interface{}{"listChanged": true},
			"resources": map[string]interface{}{"subscribe": false, "listChanged": true},
			"prompts":   map[string]interface{}{"listChanged": true},
		},
		"serverInfo": map[string]interface{}{
			"name":           fmt.Sprintf("AI Gateway Virtual Server [%s]", proj.Name),
			"version":        "1.0.0",
			"config_version": proj.ConfigVersion,
			"project_slug":   proj.Slug,
			"servers_count":  len(proj.Servers),
		},
	})
}

// HandleToolsList fans out to all enabled downstream servers in parallel,
// applies ToolPolicies (enable/disable, rename), namespaces tool names ({prefix}__{name}),
// and degrades gracefully on partial downstream failure.
func (a *MCPAggregator) HandleToolsList(ctx context.Context, req *JSONRPCRequest, proj *Project) *JSONRPCResponse {
	// Check 3-second short cache
	a.cacheMu.RLock()
	cached, found := a.toolCache[proj.Slug]
	a.cacheMu.RUnlock()

	if found && cached.version == proj.ConfigVersion && time.Since(cached.createdAt) < 3*time.Second {
		meta := map[string]interface{}{
			"cached":      true,
			"total_tools": len(cached.tools),
		}
		if len(cached.warnings) > 0 {
			meta["warnings"] = cached.warnings
		}
		return NewJSONRPCResponse(req.ID, MCPToolsListResult{
			Tools: cached.tools,
			Meta:  meta,
		})
	}

	var enabledServers []MCPServer
	for _, s := range proj.Servers {
		if s.Enabled {
			enabledServers = append(enabledServers, s)
		}
	}

	if len(enabledServers) == 0 {
		return NewJSONRPCResponse(req.ID, MCPToolsListResult{
			Tools: []MCPTool{},
			Meta:  map[string]interface{}{"total_tools": 0},
		})
	}

	type serverResult struct {
		server  MCPServer
		tools   []MCPTool
		warning string
	}

	resultsChan := make(chan serverResult, len(enabledServers))
	var wg sync.WaitGroup

	for _, s := range enabledServers {
		wg.Add(1)
		go func(srv MCPServer) {
			defer wg.Done()

			// Per-downstream timeout
			subCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			listReq := &JSONRPCRequest{
				JSONRPC: "2.0",
				ID:      1,
				Method:  "tools/list",
				Params:  json.RawMessage(`{}`),
			}

			resp, _, err := a.pool.Execute(subCtx, &srv, listReq)
			if err != nil {
				a.logger.Warn("downstream tools/list failed", "server", srv.Name, "error", err)
				resultsChan <- serverResult{
					server:  srv,
					warning: fmt.Sprintf("Downstream server %q unavailable: %v", srv.Name, err),
				}
				return
			}

			if resp.Error != nil {
				a.logger.Warn("downstream tools/list returned rpc error", "server", srv.Name, "code", resp.Error.Code, "msg", resp.Error.Message)
				resultsChan <- serverResult{
					server:  srv,
					warning: fmt.Sprintf("Downstream server %q returned error (%d): %s", srv.Name, resp.Error.Code, resp.Error.Message),
				}
				return
			}

			// Parse tools array from result
			resRaw, err := json.Marshal(resp.Result)
			if err != nil {
				resultsChan <- serverResult{server: srv, warning: fmt.Sprintf("Downstream server %q invalid result payload", srv.Name)}
				return
			}

			var listRes struct {
				Tools []MCPTool `json:"tools"`
			}
			if err := json.Unmarshal(resRaw, &listRes); err != nil {
				resultsChan <- serverResult{server: srv, warning: fmt.Sprintf("Downstream server %q tools decode failed: %v", srv.Name, err)}
				return
			}

			resultsChan <- serverResult{
				server: srv,
				tools:  listRes.Tools,
			}
		}(s)
	}

	wg.Wait()
	close(resultsChan)

	var aggregatedTools []MCPTool
	var warnings []string

	for res := range resultsChan {
		if res.warning != "" {
			warnings = append(warnings, res.warning)
		}

		// Build fast policy lookup map
		policyMap := make(map[string]ToolPolicy)
		for _, tp := range res.server.ToolPolicies {
			policyMap[tp.ToolName] = tp
		}

		for _, tool := range res.tools {
			baseName := tool.Name

			// Apply ToolPolicy
			if pol, exists := policyMap[baseName]; exists {
				if !pol.Enabled {
					// Tool disabled by policy: filter out
					continue
				}
				if pol.Rename != nil && *pol.Rename != "" {
					baseName = *pol.Rename
				}
			}

			// Apply Namespacing: {prefix}__{tool}
			namespacedName := baseName
			if res.server.NamespacePrefix != "" {
				prefix := res.server.NamespacePrefix
				if !strings.HasPrefix(baseName, prefix+"__") {
					namespacedName = fmt.Sprintf("%s__%s", prefix, baseName)
				}
			}

			tool.Name = namespacedName
			aggregatedTools = append(aggregatedTools, tool)
		}
	}

	// Update short-term cache
	a.cacheMu.Lock()
	a.toolCache[proj.Slug] = toolCacheEntry{
		tools:     aggregatedTools,
		warnings:  warnings,
		version:   proj.ConfigVersion,
		createdAt: time.Now(),
	}
	a.cacheMu.Unlock()

	meta := map[string]interface{}{
		"total_tools": len(aggregatedTools),
	}
	if len(warnings) > 0 {
		meta["warnings"] = warnings
	}

	return NewJSONRPCResponse(req.ID, MCPToolsListResult{
		Tools: aggregatedTools,
		Meta:  meta,
	})
}

// HandleToolsCall parses tool name, strips namespace prefix, applies policy checks,
// and routes the invocation to the correct downstream MCP server.
func (a *MCPAggregator) HandleToolsCall(ctx context.Context, req *JSONRPCRequest, proj *Project) (*JSONRPCResponse, string, string, error) {
	var params MCPToolCallParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return NewJSONRPCError(req.ID, ErrCodeInvalidParams, "Invalid tools/call params: must provide 'name'", err.Error()), "", "", nil
	}

	callName := params.Name
	if callName == "" {
		return NewJSONRPCError(req.ID, ErrCodeInvalidParams, "Missing required parameter: 'name'", nil), "", "", nil
	}

	// Resolve target server and downstream tool name
	var targetServer *MCPServer
	var targetToolName string
	var policyRejected bool

	for i := range proj.Servers {
		srv := &proj.Servers[i]
		if !srv.Enabled {
			continue
		}

		prefix := srv.NamespacePrefix
		if prefix != "" {
			expectedPrefix := prefix + "__"
			if strings.HasPrefix(callName, expectedPrefix) {
				stripped := strings.TrimPrefix(callName, expectedPrefix)
				targetServer = srv
				targetToolName = stripped

				// Check policies for rename or disable
				for _, tp := range srv.ToolPolicies {
					if tp.Rename != nil && *tp.Rename == stripped {
						if !tp.Enabled {
							policyRejected = true
						}
						targetToolName = tp.ToolName
						break
					}
					if tp.ToolName == stripped {
						if !tp.Enabled {
							policyRejected = true
						}
						break
					}
				}
				break
			}
		} else {
			// No prefix defined for this server, check tool policies
			for _, tp := range srv.ToolPolicies {
				if tp.Rename != nil && *tp.Rename == callName {
					if !tp.Enabled {
						policyRejected = true
					}
					targetServer = srv
					targetToolName = tp.ToolName
					break
				}
				if tp.ToolName == callName {
					if !tp.Enabled {
						policyRejected = true
					}
					targetServer = srv
					targetToolName = callName
					break
				}
			}
			if targetServer != nil {
				break
			}
		}
	}

	if targetServer == nil {
		return NewJSONRPCError(req.ID, ErrCodeMethodNotFound, fmt.Sprintf("Tool not found: %s", callName), nil), "", callName, nil
	}

	if policyRejected {
		return NewJSONRPCError(req.ID, ErrCodePolicyRejected, fmt.Sprintf("Tool %q is disabled by policy", callName), nil), targetServer.Name, callName, nil
	}

	// Build forwarded JSON-RPC request for downstream
	forwardParams := map[string]interface{}{
		"name":      targetToolName,
		"arguments": params.Arguments,
	}
	fwdParamsRaw, _ := json.Marshal(forwardParams)

	fwdReq := &JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      req.ID,
		Method:  "tools/call",
		Params:  fwdParamsRaw,
	}

	subCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	resp, traceID, err := a.pool.Execute(subCtx, targetServer, fwdReq)
	if err != nil {
		a.logger.Error("downstream tools/call failed", "server", targetServer.Name, "tool", targetToolName, "trace_id", traceID, "error", err)
		return NewJSONRPCError(req.ID, ErrCodeDownstream, fmt.Sprintf("Downstream server %q error: %v", targetServer.Name, err), nil), targetServer.Name, targetToolName, err
	}

	a.logger.Debug("downstream tools/call succeeded", "server", targetServer.Name, "tool", targetToolName, "trace_id", traceID)
	return resp, targetServer.Name, targetToolName, nil
}

// HandlePromptsList aggregates prompts across enabled downstream servers
func (a *MCPAggregator) HandlePromptsList(ctx context.Context, req *JSONRPCRequest, proj *Project) *JSONRPCResponse {
	var aggregatedPrompts []MCPPrompt
	for _, s := range proj.Servers {
		if !s.Enabled {
			continue
		}
		subCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		resp, _, err := a.pool.Execute(subCtx, &s, &JSONRPCRequest{
			JSONRPC: "2.0",
			ID:      1,
			Method:  "prompts/list",
			Params:  json.RawMessage(`{}`),
		})
		cancel()

		if err != nil || resp.Error != nil {
			continue
		}

		resRaw, _ := json.Marshal(resp.Result)
		var listRes struct {
			Prompts []MCPPrompt `json:"prompts"`
		}
		if err := json.Unmarshal(resRaw, &listRes); err == nil {
			for _, p := range listRes.Prompts {
				if s.NamespacePrefix != "" {
					p.Name = fmt.Sprintf("%s__%s", s.NamespacePrefix, p.Name)
				}
				aggregatedPrompts = append(aggregatedPrompts, p)
			}
		}
	}

	return NewJSONRPCResponse(req.ID, map[string]interface{}{
		"prompts": aggregatedPrompts,
	})
}

// HandleResourcesList aggregates resources across enabled downstream servers
func (a *MCPAggregator) HandleResourcesList(ctx context.Context, req *JSONRPCRequest, proj *Project) *JSONRPCResponse {
	var aggregatedResources []MCPResource
	for _, s := range proj.Servers {
		if !s.Enabled {
			continue
		}
		subCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		resp, _, err := a.pool.Execute(subCtx, &s, &JSONRPCRequest{
			JSONRPC: "2.0",
			ID:      1,
			Method:  "resources/list",
			Params:  json.RawMessage(`{}`),
		})
		cancel()

		if err != nil || resp.Error != nil {
			continue
		}

		resRaw, _ := json.Marshal(resp.Result)
		var listRes struct {
			Resources []MCPResource `json:"resources"`
		}
		if err := json.Unmarshal(resRaw, &listRes); err == nil {
			for _, r := range listRes.Resources {
				if s.NamespacePrefix != "" {
					r.URI = fmt.Sprintf("%s://%s", s.NamespacePrefix, strings.TrimPrefix(r.URI, "://"))
					r.Name = fmt.Sprintf("%s__%s", s.NamespacePrefix, r.Name)
				}
				aggregatedResources = append(aggregatedResources, r)
			}
		}
	}

	return NewJSONRPCResponse(req.ID, map[string]interface{}{
		"resources": aggregatedResources,
	})
}

// HandlePing standard MCP ping
func (a *MCPAggregator) HandlePing(req *JSONRPCRequest) *JSONRPCResponse {
	return NewJSONRPCResponse(req.ID, map[string]interface{}{})
}
