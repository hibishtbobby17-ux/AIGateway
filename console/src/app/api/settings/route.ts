import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';
import { getSessionFromRequest } from '@/lib/api-auth';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const DEFAULT_SETTINGS = {
  tls: {
    inbound: {
      protocol: 'https',
      cert_mode: 'auto_cert',
      min_version: 'TLS 1.3',
      sans: ['localhost', '127.0.0.1', '::1', 'ai-gateway.corp.local'],
      client_auth: 'none',
      cert_pem: '',
      key_pem: '',
      client_ca_pem: '',
      cipher_suites: [
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256'
      ]
    },
    downstream: {
      insecure_skip_verify: false,
      min_version: 'TLS 1.2',
      custom_ca_pem: '',
      client_cert_pem: '',
      client_key_pem: ''
    }
  },
  gateway: {
    public_url: process.env.GATEWAY_PUBLIC_URL || 'http://localhost:8080',
    dial_timeout_ms: 5000,
    call_timeout_ms: 15000,
    fail_static_cache: true,
    cache_ttl_seconds: 300,
    heartbeat_interval_sec: 15
  }
};

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const orgRes = await pool.query(
      'SELECT id, name, settings FROM organizations WHERE id = $1',
      [session.orgId]
    );

    let savedSettings = {};
    if (orgRes.rows.length > 0 && orgRes.rows[0].settings) {
      savedSettings = orgRes.rows[0].settings;
    }

    const merged = {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      tls: {
        ...DEFAULT_SETTINGS.tls,
        ...(savedSettings as any)?.tls,
        inbound: {
          ...DEFAULT_SETTINGS.tls.inbound,
          ...((savedSettings as any)?.tls?.inbound || {})
        },
        downstream: {
          ...DEFAULT_SETTINGS.tls.downstream,
          ...((savedSettings as any)?.tls?.downstream || {})
        }
      },
      gateway: {
        ...DEFAULT_SETTINGS.gateway,
        ...(savedSettings as any)?.gateway,
      }
    };

    return NextResponse.json({ settings: merged });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await initDatabase();

    const body = await req.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 });
    }

    const orgRes = await pool.query(
      'SELECT settings FROM organizations WHERE id = $1',
      [session.orgId]
    );

    const existingSettings = orgRes.rows[0]?.settings || {};
    const updatedSettings = {
      ...existingSettings,
      ...settings,
    };

    await pool.query(
      'UPDATE organizations SET settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(updatedSettings), session.orgId]
    );

    // Bump config version across projects so gateways trigger a poll and sync
    await pool.query(
      'UPDATE projects SET config_version = (SELECT COALESCE(MAX(config_version), 0) + 1 FROM projects), updated_at = NOW() WHERE org_id = $1',
      [session.orgId]
    );

    await logAudit({
      orgId: session.orgId,
      actor: session.email,
      action: 'settings.update_tls_and_network',
      target: `org:${session.orgId}`,
      diff: { updated_keys: Object.keys(settings) }
    });

    return NextResponse.json({
      success: true,
      message: 'Platform and certificate settings saved. Changes will sync to data plane.',
      settings: updatedSettings
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
