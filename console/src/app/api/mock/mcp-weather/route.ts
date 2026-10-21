import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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
          serverInfo: { name: 'Mock Weather MCP Server', version: '2.0.1' }
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
              name: 'get_current_weather',
              description: 'Retrieve real-time temperature, humidity, and atmospheric conditions',
              inputSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'City name or airport IATA code' },
                  units: { type: 'string', enum: ['metric', 'imperial'], default: 'metric' }
                },
                required: ['city']
              }
            },
            {
              name: 'get_forecast',
              description: 'Fetch multi-day weather predictions and precipitation probability',
              inputSchema: {
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'City name' },
                  days: { type: 'integer', minimum: 1, maximum: 7, default: 3 }
                },
                required: ['city']
              }
            }
          ]
        }
      });
    }

    if (method === 'tools/call') {
      const toolName = body.params?.name;
      const city = body.params?.arguments?.city || 'Unknown';

      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          content: [
            {
              type: 'text',
              text: `Weather for ${city}: 21°C, Partly Cloudy, 45% Humidity. Tool executed: ${toolName}`
            }
          ]
        }
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
