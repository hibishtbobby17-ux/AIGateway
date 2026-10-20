package policy

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

type SQLRepository struct {
	db *sql.DB
}

func NewSQLRepository(db *sql.DB) (*SQLRepository, error) {
	if db == nil {
		return nil, errors.New("policy SQL repository requires a database")
	}
	return &SQLRepository{db: db}, nil
}

func (r *SQLRepository) LoadEngine(ctx context.Context) (*Engine, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, tenant_id, name, effect, actions, resources, roles, required_scopes, conditions
		FROM policies
		ORDER BY tenant_id, id`)
	if err != nil {
		return nil, fmt.Errorf("query persisted policies: %w", err)
	}
	defer rows.Close()

	engine := NewEngine()
	for rows.Next() {
		var (
			rule                       Rule
			effect, actions, resources string
			roles, requiredScopes      string
			conditions                 sql.NullString
		)
		if err := rows.Scan(
			&rule.ID, &rule.TenantID, &rule.Name, &effect, &actions, &resources,
			&roles, &requiredScopes, &conditions,
		); err != nil {
			return nil, fmt.Errorf("scan persisted policy: %w", err)
		}
		rule.Effect = Effect(effect)
		if err := decodePolicyField(rule.ID, "actions", actions, &rule.Actions); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "resources", resources, &rule.Resources); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "roles", roles, &rule.Roles); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "required_scopes", requiredScopes, &rule.RequiredScopes); err != nil {
			return nil, err
		}
		if conditions.Valid && conditions.String != "" {
			if err := decodePolicyField(rule.ID, "conditions", conditions.String, &rule.Conditions); err != nil {
				return nil, err
			}
		}
		if err := engine.AddRule(&rule); err != nil {
			return nil, fmt.Errorf("validate persisted policy %q: %w", rule.ID, err)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate persisted policies: %w", err)
	}
	return engine, nil
}

func decodePolicyField(ruleID, field, encoded string, target any) error {
	if err := json.Unmarshal([]byte(encoded), target); err != nil {
		return fmt.Errorf("decode persisted policy %q field %s: %w", ruleID, field, err)
	}
	return nil
}

// CreateRule inserts a new policy rule for a tenant.
func (r *SQLRepository) CreateRule(ctx context.Context, rule *Rule) error {
	if rule == nil {
		return errors.New("policy rule cannot be nil")
	}
	if rule.ID == "" || rule.TenantID == "" || rule.Name == "" {
		return errors.New("rule id, tenant_id, and name are required")
	}
	if rule.Effect != EffectAllow && rule.Effect != EffectDeny {
		return fmt.Errorf("invalid policy effect %q", rule.Effect)
	}

	actionsJSON, err := json.Marshal(rule.Actions)
	if err != nil {
		return fmt.Errorf("encode actions: %w", err)
	}
	resourcesJSON, err := json.Marshal(rule.Resources)
	if err != nil {
		return fmt.Errorf("encode resources: %w", err)
	}
	rolesJSON, err := json.Marshal(rule.Roles)
	if err != nil {
		return fmt.Errorf("encode roles: %w", err)
	}
	scopesJSON, err := json.Marshal(rule.RequiredScopes)
	if err != nil {
		return fmt.Errorf("encode required_scopes: %w", err)
	}
	var conditionsJSON sql.NullString
	if rule.Conditions != nil {
		bytes, err := json.Marshal(rule.Conditions)
		if err != nil {
			return fmt.Errorf("encode conditions: %w", err)
		}
		conditionsJSON = sql.NullString{String: string(bytes), Valid: true}
	}

	query := `
	INSERT INTO policies (id, tenant_id, name, effect, actions, resources, roles, required_scopes, conditions)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err = r.db.ExecContext(ctx, query,
		rule.ID, rule.TenantID, rule.Name, string(rule.Effect),
		string(actionsJSON), string(resourcesJSON), string(rolesJSON), string(scopesJSON),
		conditionsJSON,
	)
	if err != nil {
		return fmt.Errorf("insert policy rule: %w", err)
	}
	return nil
}

// ListRules retrieves all policy rules for a specific tenant.
func (r *SQLRepository) ListRules(ctx context.Context, tenantID string) ([]*Rule, error) {
	if tenantID == "" {
		return nil, errors.New("tenant_id is required to list policies")
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, tenant_id, name, effect, actions, resources, roles, required_scopes, conditions
		FROM policies
		WHERE tenant_id = $1
		ORDER BY id`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("query policies for tenant %s: %w", tenantID, err)
	}
	defer rows.Close()

	var rules []*Rule
	for rows.Next() {
		var (
			rule                       Rule
			effect, actions, resources string
			roles, requiredScopes      string
			conditions                 sql.NullString
		)
		if err := rows.Scan(
			&rule.ID, &rule.TenantID, &rule.Name, &effect, &actions, &resources,
			&roles, &requiredScopes, &conditions,
		); err != nil {
			return nil, fmt.Errorf("scan policy: %w", err)
		}
		rule.Effect = Effect(effect)
		if err := decodePolicyField(rule.ID, "actions", actions, &rule.Actions); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "resources", resources, &rule.Resources); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "roles", roles, &rule.Roles); err != nil {
			return nil, err
		}
		if err := decodePolicyField(rule.ID, "required_scopes", requiredScopes, &rule.RequiredScopes); err != nil {
			return nil, err
		}
		if conditions.Valid && conditions.String != "" {
			if err := decodePolicyField(rule.ID, "conditions", conditions.String, &rule.Conditions); err != nil {
				return nil, err
			}
		}
		rules = append(rules, &rule)
	}
	return rules, rows.Err()
}

// GetRule fetches a single policy rule by tenant and ID.
func (r *SQLRepository) GetRule(ctx context.Context, tenantID, ruleID string) (*Rule, error) {
	if tenantID == "" || ruleID == "" {
		return nil, errors.New("tenant_id and rule_id are required")
	}

	query := `
		SELECT id, tenant_id, name, effect, actions, resources, roles, required_scopes, conditions
		FROM policies
		WHERE tenant_id = $1 AND id = $2
	`
	var (
		rule                       Rule
		effect, actions, resources string
		roles, requiredScopes      string
		conditions                 sql.NullString
	)
	err := r.db.QueryRowContext(ctx, query, tenantID, ruleID).Scan(
		&rule.ID, &rule.TenantID, &rule.Name, &effect, &actions, &resources,
		&roles, &requiredScopes, &conditions,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errors.New("policy rule not found")
		}
		return nil, fmt.Errorf("scan policy %s: %w", ruleID, err)
	}

	rule.Effect = Effect(effect)
	if err := decodePolicyField(rule.ID, "actions", actions, &rule.Actions); err != nil {
		return nil, err
	}
	if err := decodePolicyField(rule.ID, "resources", resources, &rule.Resources); err != nil {
		return nil, err
	}
	if err := decodePolicyField(rule.ID, "roles", roles, &rule.Roles); err != nil {
		return nil, err
	}
	if err := decodePolicyField(rule.ID, "required_scopes", requiredScopes, &rule.RequiredScopes); err != nil {
		return nil, err
	}
	if conditions.Valid && conditions.String != "" {
		if err := decodePolicyField(rule.ID, "conditions", conditions.String, &rule.Conditions); err != nil {
			return nil, err
		}
	}
	return &rule, nil
}

// DeleteRule removes a policy rule scoped to a specific tenant.
func (r *SQLRepository) DeleteRule(ctx context.Context, tenantID, ruleID string) error {
	if tenantID == "" || ruleID == "" {
		return errors.New("tenant_id and rule_id are required")
	}

	query := `DELETE FROM policies WHERE tenant_id = $1 AND id = $2`
	res, err := r.db.ExecContext(ctx, query, tenantID, ruleID)
	if err != nil {
		return fmt.Errorf("delete policy rule: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check deleted rows: %w", err)
	}
	if n == 0 {
		return errors.New("policy rule not found")
	}
	return nil
}

