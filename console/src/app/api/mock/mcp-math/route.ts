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
          serverInfo: { name: 'Mock Math MCP Server', version: '1.2.0' }
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
              name: 'add',
              description: 'Calculate the sum of two numerical values',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'First operand' },
                  b: { type: 'number', description: 'Second operand' }
                },
                required: ['a', 'b']
              }
            },
            {
              name: 'multiply',
              description: 'Calculate the mathematical product of two numbers',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: 'Multiplier' },
                  b: { type: 'number', description: 'Multiplicand' }
                },
                required: ['a', 'b']
              }
            },
            {
              name: 'calculate_stats',
              description: 'Compute statistical mean, median, and variance of a dataset',
              inputSchema: {
                type: 'object',
                properties: {
                  dataset: {
                    type: 'array',
                    items: { type: 'number' },
                    description: 'List of numbers to analyze'
                  }
                },
                required: ['dataset']
              }
            }
          ]
        }
      });
    }

    if (method === 'tools/call') {
      const toolName = body.params?.name;
      const args = body.params?.arguments || {};

      let resultText = '';
      if (toolName === 'add') {
        resultText = String((args.a || 0) + (args.b || 0));
      } else if (toolName === 'multiply') {
        resultText = String((args.a || 0) * (args.b || 0));
      } else {
        resultText = 'mock stats calculated';
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: id ?? 1,
        result: {
          content: [{ type: 'text', text: resultText }]
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
