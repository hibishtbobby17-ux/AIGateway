import { NextRequest, NextResponse } from 'next/server';
import { pool, initDatabase } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await initDatabase();
    const url = new URL(req.url);

    const project = url.searchParams.get('project');
    const server = url.searchParams.get('server');
    const tool = url.searchParams.get('tool');
    const status = url.searchParams.get('status');
    const traceId = url.searchParams.get('trace_id');
    const search = url.searchParams.get('search');
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

    const whereClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (project) {
      whereClauses.push(`project = $${paramIndex++}`);
      values.push(project);
    }
    if (server) {
      whereClauses.push(`mcp_server = $${paramIndex++}`);
      values.push(server);
    }
    if (tool) {
      whereClauses.push(`(tool = $${paramIndex} OR tool ILIKE '%' || $${paramIndex} OR $${paramIndex} ILIKE '%' || tool)`);
      values.push(tool);
      paramIndex++;
    }
    if (status) {
      whereClauses.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (traceId) {
      whereClauses.push(`trace_id = $${paramIndex++}`);
      values.push(traceId);
    }
    if (search) {
      whereClauses.push(`(tool ILIKE $${paramIndex} OR mcp_server ILIKE $${paramIndex} OR error ILIKE $${paramIndex} OR project ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count query
    const countSql = `SELECT COUNT(*) AS total FROM gateway_logs ${whereSql}`;
    const countRes = await pool.query(countSql, values);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    // Data query
    const dataValues = [...values, limit, offset];
    const dataSql = `
      SELECT 
        id,
        event_id,
        project,
        mcp_server,
        tool,
        client_id,
        status,
        latency_ms,
        bytes_in,
        bytes_out,
        trace_id,
        error,
        attributes,
        timestamp,
        created_at
      FROM gateway_logs
      ${whereSql}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const dataRes = await pool.query(dataSql, dataValues);

    return NextResponse.json({
      logs: dataRes.rows,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('Error fetching logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gateway logs', details: error.message },
      { status: 500 }
    );
  }
}
