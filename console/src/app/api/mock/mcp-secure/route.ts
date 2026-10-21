import { NextRequest, NextResponse } from 'next/server';
import { verifyMockIdpToken } from '@/lib/idp';

export const dynamic = 'force-dynamic';

function authenticateDownstream(req: NextRequest): { authorized: boolean; error?: string } {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authorized: false, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.substring(7);
  try {
    verifyMockIdpToken(token);
    return { authorized: true };
  } catch (err: any) {
    return { authorized: false, error: err.message || 'Token verification failed' };
  }
}

export async function POST(req: NextRequest) {
  // 1. Verify Outbound Bearer Token
  const auth = authenticateDownstream(req);
  if (!auth.authorized) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: `Unauthorized: ${auth.error}` }
      },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': `Bearer error="invalid_token", error_description="${auth.error}"`
        }
      }
    );
  }

  try {
    const body = await req.json();
    const { method, id } = body;

    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'Secure Mock MCP Server', version: '3.0.0', auth: 'oauth_verified' }
        }
      });
    }

    if (method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          tools: [
            {
              name: 'secure_echo',
              description: 'Securely echo confidential parameters with OAuth verification',
              inputSchema: {
                type: 'object',
                properties: {
                  message: { type: 'string', description: 'Message to securely echo' }
                },
                required: ['message']
              }
            },
            {
              name: 'get_confidential_report',
              description: 'Retrieve authorized financial ledger analytics',
              inputSchema: {
                type: 'object',
                properties: {
                  report_id: { type: 'string', description: 'Report identifier' }
                },
                required: ['report_id']
              }
            }
          ]
        }
      });
    }

    if (method === 'tools/call') {
      const toolName = body.params?.name;
      const args = body.params?.arguments || {};

      if (toolName === 'secure_echo') {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [{ type: 'text', text: `OAuth Verified Echo: ${args.message}` }]
          }
        });
      }

      if (toolName === 'get_confidential_report') {
        return NextResponse.json({
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            content: [{ type: 'text', text: `Confidential Report [${args.report_id}]: Status=APPROVED, Revenue=$4.2M` }]
          }
        });
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32601, message: `Tool not found: ${toolName}` }
      });
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      id: id ?? 1,
      error: { code: -32601, message: `Method not found: ${method}` }
    }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error', data: err.message }
    }, { status: 400 });
  }
}
