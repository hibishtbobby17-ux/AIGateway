package admin

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"project_alpha/internal/api/middleware"
	"project_alpha/internal/identity/principal"
	"project_alpha/internal/tenants"
)

// HandleProjects routes tenant-scoped project management endpoints:
//   GET  /api/v1/projects
//   POST /api/v1/projects
func (h *Handler) HandleProjects(w http.ResponseWriter, r *http.Request) {
	p, ok := principal.FromContext(r.Context())
	if !ok || p.TenantID == "" {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	if h.tenantsRepo == nil {
		middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tenant repository not configured"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		projects, err := h.tenantsRepo.ListProjects(r.Context(), p.TenantID)
		if err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if projects == nil {
			projects = []*tenants.Project{}
		}
		middleware.WriteJSON(w, http.StatusOK, projects)

	case http.MethodPost:
		var proj tenants.Project
		if err := json.NewDecoder(r.Body).Decode(&proj); err != nil {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
			return
		}

		if strings.TrimSpace(proj.Name) == "" || strings.TrimSpace(proj.Slug) == "" {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "name and slug are required"})
			return
		}

		proj.TenantID = p.TenantID
		if proj.ID == "" {
			proj.ID = uuid.NewString()
		}

		if err := h.tenantsRepo.CreateProject(r.Context(), &proj); err != nil {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		middleware.WriteJSON(w, http.StatusCreated, proj)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
