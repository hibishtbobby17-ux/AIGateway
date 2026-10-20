DROP INDEX IF EXISTS idx_policies_tenant_effect;
ALTER TABLE policies DROP COLUMN required_scopes;
ALTER TABLE policies DROP COLUMN roles;
