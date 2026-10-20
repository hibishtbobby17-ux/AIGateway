ALTER TABLE policies ADD COLUMN roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE policies ADD COLUMN required_scopes TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_policies_tenant_effect
    ON policies (tenant_id, effect);
