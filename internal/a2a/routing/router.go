package routing

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"AIGateway/internal/a2a/protocol"
	"AIGateway/internal/a2a/registry"
	"AIGateway/internal/a2a/tasks"
	"AIGateway/internal/identity/delegation"
)

var (
	ErrAgentNotConfigured = errors.New("agent is not configured")
)

// ClientFactory creates AgentClient instances for registered agents.
type ClientFactory func(agent *registry.Agent) (AgentClient, error)

// Router coordinates agent discovery, client resolution, task dispatching,
// and lifecycle state tracking.
type Router struct {
	registry           registry.Registry
	store              tasks.Store
	clientFactory      ClientFactory
	credentialProvider delegation.CredentialProvider
	allowLocalEgress   bool
	allowedCIDRs       []string
	mu                 sync.RWMutex
	clients            map[string]AgentClient // key: agent.ID
}

// RouterConfig holds options for initializing Router.
type RouterConfig struct {
	Registry           registry.Registry
	Store              tasks.Store
	ClientFactory      ClientFactory
	CredentialProvider delegation.CredentialProvider
	AllowLocalEgress   bool
	AllowedCIDRs       []string
}

// NewRouter creates a new A2A Router.
func NewRouter(cfg RouterConfig) *Router {
	r := &Router{
		registry:           cfg.Registry,
		store:              cfg.Store,
		clientFactory:      cfg.ClientFactory,
		credentialProvider: cfg.CredentialProvider,
		allowLocalEgress:   cfg.AllowLocalEgress,
		allowedCIDRs:       cfg.AllowedCIDRs,
		clients:            make(map[string]AgentClient),
	}
	if r.clientFactory == nil {
		r.clientFactory = r.defaultClientFactory
	}
	return r
}

func (r *Router) defaultClientFactory(agent *registry.Agent) (AgentClient, error) {
	var authCfg delegation.UpstreamAuthConfig
	authCfg.Type = agent.AuthType
	if agent.AgentCard.Authentication.Audience != "" {
		authCfg.Audience = agent.AgentCard.Authentication.Audience
	}
	if len(agent.AgentCard.Authentication.Scopes) > 0 {
		authCfg.RequestedScopes = agent.AgentCard.Authentication.Scopes
	}

	concurrencyLimit := agent.AgentCard.RateLimits.ConcurrencyLimit
	if concurrencyLimit <= 0 {
		concurrencyLimit = 50
	}

	return NewHTTPAgentClient(ClientConfig{
		AgentID:            agent.ID,
		EndpointURL:        agent.EndpointURL,
		CredentialProvider: r.credentialProvider,
		AuthConfig:         authCfg,
		Timeout:            30 * time.Second,
		ConcurrencyLimit:   concurrencyLimit,
		MaxRetries:         3,
		AllowLocalEgress:   r.allowLocalEgress,
		AllowedCIDRs:       r.allowedCIDRs,
	}), nil
}

// GetClient retrieves or constructs an AgentClient for the given agent.
func (r *Router) GetClient(ctx context.Context, agent *registry.Agent) (AgentClient, error) {
	if agent == nil || agent.ID == "" {
		return nil, ErrAgentNotConfigured
	}

	r.mu.RLock()
	client, ok := r.clients[agent.ID]
	r.mu.RUnlock()
	if ok {
		return client, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Double-check under lock
	if client, ok := r.clients[agent.ID]; ok {
		return client, nil
	}

	newClient, err := r.clientFactory(agent)
	if err != nil {
		return nil, fmt.Errorf("failed creating agent client: %w", err)
	}
	r.clients[agent.ID] = newClient
	return newClient, nil
}

// ExecuteTask dispatches an admitted task to its destination agent and manages lifecycle state updates.
func (r *Router) ExecuteTask(ctx context.Context, task *protocol.Task) (*protocol.TaskResponse, error) {
	if task == nil {
		return nil, errors.New("task cannot be nil")
	}

	// 1. Resolve agent from registry with tenant isolation
	agent, err := r.registry.GetAgent(ctx, task.TenantID, task.TargetAgentID)
	if err != nil {
		return nil, fmt.Errorf("target agent not found: %w", err)
	}

	// 2. Transition task to RUNNING in durable store
	if err := r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusRunning, nil, "", ""); err != nil {
		return nil, fmt.Errorf("failed transitioning task to RUNNING: %w", err)
	}

	// 3. Resolve client handle
	client, err := r.GetClient(ctx, agent)
	if err != nil {
		_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusFailed, nil, "CLIENT_INIT_FAILED", err.Error())
		return nil, err
	}

	// 4. Setup execution context with optional deadline
	execCtx := ctx
	var cancel context.CancelFunc
	if task.Deadline != nil && !task.Deadline.IsZero() {
		execCtx, cancel = context.WithDeadline(ctx, *task.Deadline)
		defer cancel()
	}

	// 5. Submit task to upstream agent
	resp, submitErr := client.SubmitTask(execCtx, task)
	if submitErr != nil {
		if errors.Is(execCtx.Err(), context.DeadlineExceeded) || (task.Deadline != nil && time.Now().After(*task.Deadline)) {
			_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusTimedOut, nil, "DEADLINE_EXCEEDED", "task execution deadline exceeded")
			return nil, protocol.ErrTaskTimeout
		}
		if errors.Is(execCtx.Err(), context.Canceled) {
			_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusCancelled, nil, "CANCELLED", "task was cancelled")
			return nil, context.Canceled
		}

		_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusFailed, nil, "UPSTREAM_ERROR", submitErr.Error())
		return nil, submitErr
	}

	// 6. Handle successful upstream response
	switch resp.Status {
	case protocol.StatusCompleted:
		_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusCompleted, resp.OutputPayload, "", "")
	case protocol.StatusFailed:
		_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusFailed, nil, resp.ErrorCode, resp.ErrorMessage)
	case protocol.StatusRunning:
		// Asynchronous task ongoing upstream; task remains RUNNING
	default:
		// Default to completed if status is omitted or unrecognized
		_ = r.store.UpdateTaskStatus(ctx, task.TenantID, task.ID, protocol.StatusCompleted, resp.OutputPayload, "", "")
	}

	return resp, nil
}

// CancelTask requests upstream cancellation and transitions task status to CANCELLED.
func (r *Router) CancelTask(ctx context.Context, tenantID, taskID string) error {
	task, err := r.store.GetTask(ctx, tenantID, taskID)
	if err != nil {
		return err
	}
	if task.IsTerminal() {
		return protocol.ErrTaskAlreadyDone
	}

	agent, err := r.registry.GetAgent(ctx, tenantID, task.TargetAgentID)
	if err == nil {
		client, err := r.GetClient(ctx, agent)
		if err == nil {
			_ = client.CancelTask(ctx, taskID)
		}
	}

	return r.store.UpdateTaskStatus(ctx, tenantID, taskID, protocol.StatusCancelled, nil, "CANCELLED", "task cancelled by caller")
}

// Close closes all active agent client connections.
func (r *Router) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for id, client := range r.clients {
		_ = client.Close()
		delete(r.clients, id)
	}
	return nil
}
