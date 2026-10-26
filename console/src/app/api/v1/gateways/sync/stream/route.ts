import { NextRequest, NextResponse } from 'next/server';
import { authenticateGatewayRequest } from '@/lib/gateway-auth';
import { buildSyncSnapshot } from '@/lib/sync-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authGw = await authenticateGatewayRequest(req);
    if (!authGw) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing gateway key' },
        { status: 401 }
      );
    }

    const lastEventId = req.headers.get('last-event-id') || new URL(req.url).searchParams.get('last_event_id') || '';
    const initialSnapshot = await buildSyncSnapshot(authGw.gatewayId);

    const encoder = new TextEncoder();
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: string, id: string, data: any) => {
          if (isClosed) return;
          try {
            const raw = `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(raw));
          } catch {
            isClosed = true;
          }
        };

        // 1. Initial Connection / Synchronized Event
        sendEvent('connected', initialSnapshot.version, {
          status: 'connected',
          gateway_id: authGw.gatewayId,
          version: initialSnapshot.version,
          timestamp: new Date().toISOString(),
          routes_count: initialSnapshot.routes.length,
        });

        // 2. If client reconnected with older version, push full snapshot or drift notification
        if (lastEventId && lastEventId !== initialSnapshot.version) {
          sendEvent('route_upsert', initialSnapshot.version, {
            action: 'resync_required',
            current_version: initialSnapshot.version,
            message: 'Config version drift detected; refresh recommended',
            snapshot: initialSnapshot,
          });
        }

        // 3. Keep-alive heartbeat ticker (every 15 seconds)
        const intervalId = setInterval(async () => {
          if (isClosed) {
            clearInterval(intervalId);
            return;
          }

          try {
            // Check if version incremented
            const current = await buildSyncSnapshot(authGw.gatewayId);
            if (current.version !== initialSnapshot.version) {
              sendEvent('route_upsert', current.version, {
                action: 'update',
                version: current.version,
                routes: current.routes,
                timestamp: current.timestamp,
              });
            } else {
              // Standard SSE ping
              sendEvent('ping', current.version, {
                time: new Date().toISOString(),
                gateway_id: authGw.gatewayId,
              });
            }
          } catch {
            // Ignore error on interval
          }
        }, 15000);

        req.signal.addEventListener('abort', () => {
          isClosed = true;
          clearInterval(intervalId);
          try {
            controller.close();
          } catch {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Gateway-ID': authGw.gatewayId,
      },
    });
  } catch (err: any) {
    console.error('Error starting SSE stream:', err);
    return NextResponse.json(
      { error: err.message || 'Error starting SSE stream' },
      { status: 500 }
    );
  }
}
