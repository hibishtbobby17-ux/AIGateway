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
