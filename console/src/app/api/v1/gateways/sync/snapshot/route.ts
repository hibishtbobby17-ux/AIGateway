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

    const snapshot = await buildSyncSnapshot(authGw.gatewayId);
    const etag = `"${snapshot.version}"`;

    // Check If-None-Match header for cache validation
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === snapshot.version)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': 'no-cache, must-revalidate',
        },
      });
    }

    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-cache, must-revalidate',
        'X-Gateway-ID': authGw.gatewayId,
      },
    });
  } catch (err: any) {
    console.error('Error serving gateway sync snapshot:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error generating snapshot' },
      { status: 500 }
    );
  }
}
