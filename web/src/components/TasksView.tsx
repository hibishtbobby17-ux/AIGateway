import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { A2ATask, TaskEvent } from '../types';

interface Props {
  onSelectTrace?: (traceId: string) => void;
}

export const TasksView: React.FC<Props> = ({ onSelectTrace }) => {
  const [activeSubTab, setActiveSubTab] = useState<'a2a' | 'mcp'>('a2a');
  const [tasks, setTasks] = useState<A2ATask[]>([]);
  const [invocations, setInvocations] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<A2ATask | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === 'a2a') {
        const data = await api.listA2ATasks();
        setTasks(data || []);
      } else {
        const data = await api.listMCPInvocations(50);
        setInvocations(data || []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load task records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeSubTab, api.getTenantId()]);

  const handleSelectTask = async (task: A2ATask) => {
    setSelectedTask(task);
    try {
      const res = await api.getA2ATask(task.id);
      setTaskEvents(res.events || []);
    } catch {
      setTaskEvents([]);
    }
  };

  return (
    <div className="tasks-view">
      <div className="filter-bar">
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn ${activeSubTab === 'a2a' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setActiveSubTab('a2a'); setSelectedTask(null); }}
          >
            A2A Autonomous Tasks
          </button>
          <button
            className={`btn ${activeSubTab === 'mcp' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setActiveSubTab('mcp'); setSelectedTask(null); }}
          >
            MCP Tool Invocations
          </button>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          Refresh
        </button>
      </div>

      {error && <div className="alert-banner alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {activeSubTab === 'a2a' ? (
        <div style={{ display: 'grid', gridTemplateColumns: selectedTask ? '1fr 420px' : '1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
          <div className="glass-panel">
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
              Recent Autonomous Tasks ({tasks.length})
            </div>

            {loading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Loading tasks...
              </div>
            ) : tasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div className="empty-state-title">No A2A Tasks Executed Yet</div>
                <div className="empty-state-desc">
                  Tasks submitted through the A2A Gateway (`POST /a2a/v1/tasks`) will appear here with live lifecycle state updates and output artifacts.
                </div>
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Task ID</th>
                      <th>Status</th>
                      <th>Target Agent</th>
                      <th>Caller Client</th>
                      <th>Submitted</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => {
                      const isSelected = selectedTask?.id === t.id;
                      const isComplete = t.status === 'COMPLETED';
                      const isFailed = t.status === 'FAILED' || t.status === 'TIMED_OUT';

                      return (
                        <tr
                          key={t.id}
                          style={{
                            background: isSelected ? 'rgba(99, 102, 241, 0.1)' : undefined,
                            cursor: 'pointer',
                          }}
                          onClick={() => handleSelectTask(t)}
                        >
                          <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--cyan)' }}>
                            {t.id.substring(0, 12)}...
                          </td>
                          <td>
                            <span className={`badge badge-${isComplete ? 'healthy' : isFailed ? 'unhealthy' : 'degraded'}`}>
                              {t.status}
                            </span>
                          </td>
                          <td className="mono" style={{ fontSize: '0.8rem' }}>
                            {t.target_agent_id.substring(0, 10)}...
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{t.caller_client_id}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {new Date(t.created_at).toLocaleTimeString()}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleSelectTask(t); }}>
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Task Detail Inspector */}
          {selectedTask && (
            <div className="glass-panel" style={{ padding: '1.5rem', maxHeight: '720px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Task Execution Detail</h3>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTask(null)}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.85rem' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Task ID</div>
                  <div className="mono" style={{ color: 'var(--cyan)' }}>{selectedTask.id}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</div>
                    <span className={`badge badge-${selectedTask.status === 'COMPLETED' ? 'healthy' : 'unhealthy'}`} style={{ marginTop: '0.2rem' }}>
                      {selectedTask.status}
                    </span>
                  </div>
                  {selectedTask.trace_id && (
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Trace</div>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '0.2rem' }}
                        onClick={() => onSelectTrace && onSelectTrace(selectedTask.trace_id!)}
                      >
                        🔍 View Trace
                      </button>
                    </div>
                  )}
                </div>

                {selectedTask.error_message && (
                  <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', color: '#fca5a5' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{selectedTask.error_code || 'Execution Error'}</div>
                    <div style={{ marginTop: '0.2rem' }}>{selectedTask.error_message}</div>
                  </div>
                )}

                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                    Input Payload
                  </div>
                  <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', maxHeight: '140px', overflowY: 'auto' }}>
                    {typeof selectedTask.input_payload === 'string' ? selectedTask.input_payload : JSON.stringify(selectedTask.input_payload, null, 2)}
                  </pre>
                </div>

                {selectedTask.output_payload && (
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      Output Result
                    </div>
                    <pre style={{ background: 'rgba(0,0,0,0.4)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', maxHeight: '140px', overflowY: 'auto' }}>
                      {typeof selectedTask.output_payload === 'string' ? selectedTask.output_payload : JSON.stringify(selectedTask.output_payload, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Event Stream Timeline */}
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Chronological Event Stream ({taskEvents.length})
                  </div>
                  {taskEvents.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No events recorded for this task.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {taskEvents.map((ev) => (
                        <div key={ev.id || ev.seq} style={{ padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--cyan)' }}>
                            <span>#{ev.seq} • {ev.event_type}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                          </div>
                          {ev.payload && (
                            <div className="mono" style={{ marginTop: '0.25rem', color: 'var(--text-secondary)' }}>
                              {typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MCP Tool Invocations Sub-Tab */
        <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', fontWeight: 600 }}>
            Recent MCP Tool Call Executions ({invocations.length})
          </div>

          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading tool calls...</div>
          ) : invocations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">⚡</div>
              <div className="empty-state-title">No Tool Calls Recorded Yet</div>
              <div className="empty-state-desc">Tools executed through the unified MCP endpoint will be automatically tracked with duration and status.</div>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tool Name</th>
                    <th>Upstream Server</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th style={{ textAlign: 'right' }}>Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.map((inv) => {
                    const isErr = inv.status_code === 'ERROR';

                    return (
                      <tr key={inv.span_id}>
                        <td>
                          <span className="code-pill">{inv.tool_name}</span>
                        </td>
                        <td>{inv.server_name}</td>
                        <td className="mono" style={{ fontSize: '0.8rem' }}>{inv.duration_ms.toFixed(1)} ms</td>
                        <td>
                          <span className={`badge badge-${isErr ? 'unhealthy' : 'healthy'}`}>
                            {inv.status_code}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {inv.timestamp ? new Date(inv.timestamp).toLocaleTimeString() : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {inv.trace_id && (
                            <button
                              className="btn btn-secondary btn-sm"
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
                              onClick={() => onSelectTrace && onSelectTrace(inv.trace_id)}
                            >
                              🔍 View Trace
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
