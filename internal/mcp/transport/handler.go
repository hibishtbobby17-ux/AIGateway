package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"project_alpha/internal/mcp/aggregation"
	"project_alpha/internal/mcp/protocol"
	"project_alpha/internal/mcp/session"
	"project_alpha/internal/observability/correlation"
)

// GatewayHandler handles MCP SSE and HTTP message routing.
type GatewayHandler struct {
	aggregator      *aggregation.Aggregator
	sessions        *session.Manager
	defaultTenantID string
}

// NewGatewayHandler creates a new GatewayHandler.
func NewGatewayHandler(agg *aggregation.Aggregator, sess *session.Manager, defaultTenantID string) *GatewayHandler {
	if defaultTenantID == "" {
		defaultTenantID = "default"
	}
	return &GatewayHandler{
		aggregator:      agg,
		sessions:        sess,
		defaultTenantID: defaultTenantID,
	}
}

// HandleSSE establishes a persistent Server-Sent Events (SSE) stream for an MCP client.
func (h *GatewayHandler) HandleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported by client connection", http.StatusInternalServerError)
		return
	}

	tenantID := h.extractTenantID(r)
	sess := h.sessions.CreateSession(tenantID)
	defer h.sessions.CloseSession(sess.ID)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// Emit initial MCP "endpoint" event per protocol spec
	endpointURI := fmt.Sprintf("/mcp/v1/messages?sessionId=%s", sess.ID)
	fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", endpointURI)
	flusher.Flush()

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case resp, ok := <-sess.MessageChan:
			if !ok {
				return
			}
			data, err := json.Marshal(resp)
			if err == nil {
				fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(data))
				flusher.Flush()
			}
		}
	}
}

// HandleMessages processes inbound client JSON-RPC requests via POST.
func (h *GatewayHandler) HandleMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed: must be POST", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Bounded body read (2MB max)
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2*1024*1024))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(protocol.NewErrorResponse(nil, protocol.CodeParseError, "request payload too large or invalid", nil))
		return
	}

	var req protocol.Request
	if err := json.Unmarshal(body, &req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(protocol.NewErrorResponse(nil, protocol.CodeParseError, "failed parsing JSON-RPC request", nil))
		return
	}

	tenantID := h.extractTenantID(r)
	resp := h.dispatchMethod(r.Context(), tenantID, &req)

	// If client is bound to an active SSE session, send event to SSE channel as well
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID != "" {
		if sess, ok := h.sessions.GetSession(sessionID); ok {
			select {
			case sess.MessageChan <- resp:
			default:
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *GatewayHandler) dispatchMethod(ctx context.Context, tenantID string, req *protocol.Request) *protocol.Response {
	switch req.Method {
	case "initialize":
		var params protocol.InitializeParams
		_ = json.Unmarshal(req.Params, &params)

		result := protocol.InitializeResult{
			ProtocolVersion: protocol.ProtocolVersion,
			Capabilities: protocol.ServerCapabilities{
				Tools:     &protocol.ToolsCapability{ListChanged: true},
				Resources: &protocol.ResourcesCapability{ListChanged: true},
				Prompts:   &protocol.PromptsCapability{ListChanged: true},
			},
			ServerInfo: protocol.Implementation{
				Name:    "ai-gateway-mcp",
				Version: "1.0.0",
			},
		}
		resp, _ := protocol.NewResponse(req.ID, result)
		return resp

	case "tools/list":
		res, err := h.aggregator.ListTools(ctx, tenantID)
		if err != nil {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInternalError, fmt.Sprintf("failed listing tools: %v", err), nil)
		}
		resp, _ := protocol.NewResponse(req.ID, res)
		return resp

	case "tools/call":
		var params protocol.CallToolParams
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInvalidParams, "invalid tools/call parameters", nil)
		}
		if params.Name == "" {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInvalidParams, "tool name cannot be empty", nil)
		}

		res, err := h.aggregator.CallTool(ctx, tenantID, params.Name, params.Arguments)
		if err != nil {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInternalError, fmt.Sprintf("tool invocation failed: %v", err), nil)
		}
		resp, _ := protocol.NewResponse(req.ID, res)
		return resp

	case "resources/list":
		res, err := h.aggregator.ListResources(ctx, tenantID)
		if err != nil {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInternalError, fmt.Sprintf("failed listing resources: %v", err), nil)
		}
		resp, _ := protocol.NewResponse(req.ID, res)
		return resp

	case "prompts/list":
		res, err := h.aggregator.ListPrompts(ctx, tenantID)
		if err != nil {
			return protocol.NewErrorResponse(req.ID, protocol.CodeInternalError, fmt.Sprintf("failed listing prompts: %v", err), nil)
		}
		resp, _ := protocol.NewResponse(req.ID, res)
		return resp

	case "ping":
		resp, _ := protocol.NewResponse(req.ID, map[string]any{})
		return resp

	default:
		return protocol.NewErrorResponse(req.ID, protocol.CodeMethodNotFound, fmt.Sprintf("method %q not supported", req.Method), nil)
	}
}

func (h *GatewayHandler) extractTenantID(r *http.Request) string {
	if val := r.Context().Value(correlation.TenantIDKey); val != nil {
		if tid, ok := val.(string); ok && tid != "" {
			return tid
		}
	}
	if header := r.Header.Get("X-Tenant-ID"); header != "" {
		return header
	}
	return h.defaultTenantID
}
