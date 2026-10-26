import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    let { url, transport = 'http', auth_type = 'none', api_key = '' } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Endpoint URL is required' }, { status: 400 });
    }

    // SSRF Check
    const { validateSSRF } = await import('@/lib/ssrf');
    try {
      await validateSSRF(url);
    } catch (ssrfErr: any) {
      return NextResponse.json({
        success: false,
        status: 'unhealthy',
        error: `SSRF Policy Violation: ${ssrfErr.message}`,
        checked_url: url,
      }, { status: 400 });
    }

    // In Docker, if the URL references localhost:3000, alias to 127.0.0.1:3000
    if (url.includes('localhost:3000')) {
      url = url.replace('localhost:3000', '127.0.0.1:3000');
    }

    const startTime = Date.now();
    let healthStatus = 'unhealthy';
    let latencyMs = 0;
    let serverInfo = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (auth_type === 'api_key' && api_key) {
        headers['Authorization'] = `Bearer ${api_key}`;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'AI-Console-Registration-Probe', version: '1.0.0' }
          },
          id: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      latencyMs = Date.now() - startTime;

      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        healthStatus = 'healthy';
        serverInfo = data?.result?.serverInfo || null;
      } else {
        latencyMs = Date.now() - startTime;
        healthStatus = 'degraded';
      }
    } catch (fetchErr: any) {
      latencyMs = Date.now() - startTime;
      // If error is network refusal or mock address, return realistic diagnostic
      return NextResponse.json({
        success: false,
        status: 'unreachable',
        latency_ms: latencyMs,
        error: fetchErr.name === 'AbortError' ? 'Dial timeout exceeded (5000ms)' : (fetchErr.message || 'Connection refused'),
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      status: healthStatus,
      latency_ms: latencyMs,
      server_info: serverInfo,
      checked_url: url,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
