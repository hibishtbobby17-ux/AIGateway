import { pool } from '@/db';

export interface AuditLogEntry {
  orgId: string;
  actor: string;
  action: string;
  target: string;
  diff?: Record<string, any>;
}

// Redact sensitive keys from diffs to prevent secrets leaking to audit logs
const SENSITIVE_KEYS = new Set([
  'secret',
  'secret_hash',
  'password',
  'password_hash',
  'client_secret',
  'access_token',
  'refresh_token',
  'token',
  'key',
  'authorization',
]);

function sanitizeDiff(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeDiff(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase()) || k.toLowerCase().includes('secret') || k.toLowerCase().includes('password')) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeDiff(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const cleanDiff = entry.diff ? sanitizeDiff(entry.diff) : {};
    await pool.query(`
      INSERT INTO audit_logs (org_id, actor, action, target, timestamp, diff)
      VALUES ($1, $2, $3, $4, NOW(), $5)
    `, [
      entry.orgId,
      entry.actor || 'system',
      entry.action,
      entry.target,
      JSON.stringify(cleanDiff)
    ]);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
