package health

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

// Checker represents a component health check function.
type Checker func() error

// StatusResponse represents standard health check JSON response.
type StatusResponse struct {
	Status  string            `json:"status"`
	Details map[string]string `json:"details,omitempty"`
}

// Handler coordinates liveness, readiness, and startup HTTP probes.
type Handler struct {
	isReady   atomic.Bool
	isStarted atomic.Bool
	checkers  map[string]Checker
}

// NewHandler creates a new health probe handler.
func NewHandler() *Handler {
	h := &Handler{
		checkers: make(map[string]Checker),
	}
	h.isStarted.Store(true)
	return h
}

// SetReady updates the readiness status (e.g., set false during graceful draining).
func (h *Handler) SetReady(ready bool) {
	h.isReady.Store(ready)
}

// RegisterCheck registers a named dependency health check (e.g., "postgres").
func (h *Handler) RegisterCheck(name string, check Checker) {
	h.checkers[name] = check
}

// LivenessHandler handles /healthz (checks if process is running).
func (h *Handler) LivenessHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(StatusResponse{Status: "UP"})
}

// StartupHandler handles /startupz (checks if initial boot finished).
func (h *Handler) StartupHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.isStarted.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(StatusResponse{Status: "STARTING"})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(StatusResponse{Status: "STARTED"})
}

// ReadinessHandler handles /readyz (checks if ready to serve traffic and backing DBs are up).
func (h *Handler) ReadinessHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if !h.isReady.Load() {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(StatusResponse{
			Status:  "DRAINING_OR_INITIALIZING",
			Details: map[string]string{"readiness": "not ready to accept traffic"},
		})
		return
	}

	details := make(map[string]string)
	allHealthy := true

	for name, check := range h.checkers {
		if err := check(); err != nil {
			allHealthy = false
			details[name] = err.Error()
		} else {
			details[name] = "UP"
		}
	}

	if !allHealthy {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(StatusResponse{
			Status:  "DEGRADED",
			Details: details,
		})
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(StatusResponse{
		Status:  "READY",
		Details: details,
	})
}
