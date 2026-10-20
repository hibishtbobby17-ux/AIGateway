package storage

import (
	"sort"
	"strings"
	"time"

	"project_alpha/internal/observability/model"
)

// ComputeObservedTopology computes nodes, edges, and statistics from a slice of spans.
func ComputeObservedTopology(tenantID string, startTime, endTime time.Time, spans []*model.Span) *model.ObservedTopology {
	topo := &model.ObservedTopology{
		TenantID:       tenantID,
		TimeRangeStart: startTime,
		TimeRangeEnd:   endTime,
		Nodes:          make([]model.TopologyNode, 0),
		Edges:          make([]model.TopologyEdge, 0),
	}

	edgeMap := make(map[string]*model.TopologyEdge)
	nodeMap := make(map[string]*model.TopologyNode)
	durationsMap := make(map[string][]float64)

	ensureNode := func(id, label, nodeType, status string) *model.TopologyNode {
		if node, exists := nodeMap[id]; exists {
			return node
		}
		node := &model.TopologyNode{
			ID:       id,
			Label:    label,
			Type:     nodeType,
			Status:   status,
			Metadata: make(map[string]any),
		}
		nodeMap[id] = node
		return node
	}

	// Always ensure Gateway node exists
	ensureNode("gateway", "AI Gateway", "gateway", "HEALTHY")

	for _, s := range spans {
		if s == nil || s.TenantID != tenantID {
			continue
		}
		topo.TotalCalls++
		isErr := s.StatusCode == model.StatusCodeError
		if isErr {
			topo.TotalErrors++
		}

		var source, target, proto string
		switch {
		case strings.HasPrefix(s.Name, "mcp.") || (s.Attributes != nil && s.Attributes["mcp.server_name"] != nil):
			source = "gateway"
			serverName := "mcp-upstream"
			if s.Attributes != nil {
				if sn, ok := s.Attributes["mcp.server_name"].(string); ok && sn != "" {
					serverName = sn
				}
			}
			target = "mcp:" + serverName
			proto = "mcp"
			ensureNode(target, serverName, "mcp_server", "HEALTHY")

		case strings.HasPrefix(s.Name, "a2a.") || (s.Attributes != nil && s.Attributes["a2a.agent_name"] != nil):
			source = "gateway"
			agentName := "agent-target"
			if s.Attributes != nil {
				if an, ok := s.Attributes["a2a.agent_name"].(string); ok && an != "" {
					agentName = an
				} else if aid, ok := s.Attributes["a2a.target_agent_id"].(string); ok && aid != "" {
					agentName = aid
				}
			}
			target = "agent:" + agentName
			proto = "a2a"
			ensureNode(target, agentName, "agent", "HEALTHY")

		case s.Kind == model.SpanKindServer || strings.HasPrefix(s.Name, "HTTP ") || strings.HasPrefix(s.Name, "POST ") || strings.HasPrefix(s.Name, "GET "):
			clientName := "client-app"
			if s.Attributes != nil {
				if cid, ok := s.Attributes["client.id"].(string); ok && cid != "" {
					clientName = cid
				} else if sub, ok := s.Attributes["auth.subject"].(string); ok && sub != "" {
					clientName = sub
				}
			}
			source = "client:" + clientName
			target = "gateway"
			proto = "http"
			ensureNode(source, clientName, "client", "HEALTHY")

		default:
			source = "gateway"
			target = "service:" + s.Name
			proto = "http"
			ensureNode(target, s.Name, "service", "HEALTHY")
		}

		edgeKey := source + "->" + target
		edge, exists := edgeMap[edgeKey]
		if !exists {
			edge = &model.TopologyEdge{
				ID:             edgeKey,
				Source:         source,
				Target:         target,
				Protocol:       proto,
				SampleTraceIDs: make([]string, 0),
			}
			edgeMap[edgeKey] = edge
		}

		edge.CallCount++
		if isErr {
			edge.ErrorCount++
		}
		if s.EndTime.After(edge.LastSeen) {
			edge.LastSeen = s.EndTime
		} else if edge.LastSeen.IsZero() {
			edge.LastSeen = s.StartTime
		}
		durationsMap[edgeKey] = append(durationsMap[edgeKey], s.DurationMs)

		if s.TraceID != "" && len(edge.SampleTraceIDs) < 5 {
			hasTrace := false
			for _, tid := range edge.SampleTraceIDs {
				if tid == s.TraceID {
					hasTrace = true
					break
				}
			}
			if !hasTrace {
				edge.SampleTraceIDs = append(edge.SampleTraceIDs, s.TraceID)
			}
		}

		// Update node counters
		srcNode := ensureNode(source, source, "service", "HEALTHY")
		srcNode.CallCount++
		tgtNode := ensureNode(target, target, "service", "HEALTHY")
		tgtNode.CallCount++
		if isErr {
			srcNode.ErrorCount++
			tgtNode.ErrorCount++
		}
	}

	// Compute percentiles and averages for edges
	for edgeKey, edge := range edgeMap {
		durs := durationsMap[edgeKey]
		if len(durs) > 0 {
			sort.Float64s(durs)
			var sum float64
			for _, d := range durs {
				sum += d
			}
			edge.AvgLatencyMs = sum / float64(len(durs))
			p95Idx := int(float64(len(durs)-1) * 0.95)
			edge.P95LatencyMs = durs[p95Idx]
		}
		topo.Edges = append(topo.Edges, *edge)
	}

	// Calculate node health status based on error rate
	for _, node := range nodeMap {
		if node.CallCount > 0 {
			errRate := float64(node.ErrorCount) / float64(node.CallCount)
			if errRate > 0.5 {
				node.Status = "UNHEALTHY"
			} else if errRate > 0.1 {
				node.Status = "DEGRADED"
			} else {
				node.Status = "HEALTHY"
			}
		}
		topo.Nodes = append(topo.Nodes, *node)
	}

	// Stable sort for reproducible outputs
	sort.Slice(topo.Nodes, func(i, j int) bool {
		return topo.Nodes[i].ID < topo.Nodes[j].ID
	})
	sort.Slice(topo.Edges, func(i, j int) bool {
		return topo.Edges[i].ID < topo.Edges[j].ID
	})

	return topo
}

// ComputeMetricsSummary calculates summary metrics from a slice of spans.
func ComputeMetricsSummary(tenantID string, startTime, endTime time.Time, spans []*model.Span) *model.MetricsSummary {
	summary := &model.MetricsSummary{
		TenantID:         tenantID,
		TimeRangeStart:   startTime,
		TimeRangeEnd:     endTime,
		TopTools:         make(map[string]int64),
		TaskStatusCounts: make(map[string]int64),
	}

	if len(spans) == 0 {
		return summary
	}

	var totalLatency float64
	durations := make([]float64, 0, len(spans))

	for _, s := range spans {
		if s == nil || s.TenantID != tenantID {
			continue
		}
		summary.TotalRequests++
		if s.StatusCode == model.StatusCodeError {
			summary.TotalErrors++
		}
		totalLatency += s.DurationMs
		durations = append(durations, s.DurationMs)

		if s.Attributes != nil {
			if tool, ok := s.Attributes["mcp.tool_name"].(string); ok && tool != "" {
				summary.TopTools[tool]++
			}
			if status, ok := s.Attributes["a2a.task_status"].(string); ok && status != "" {
				summary.TaskStatusCounts[status]++
			}
		}
	}

	if summary.TotalRequests > 0 {
		summary.ErrorRatePercent = (float64(summary.TotalErrors) / float64(summary.TotalRequests)) * 100.0
		summary.AvgLatencyMs = totalLatency / float64(summary.TotalRequests)
		sort.Float64s(durations)
		p95Idx := int(float64(len(durations)-1) * 0.95)
		summary.P95LatencyMs = durations[p95Idx]
	}

	return summary
}

// ComputeTraceSummaries groups spans into trace summaries.
func ComputeTraceSummaries(spans []*model.Span) []*model.TraceSummary {
	traces := make(map[string]*model.TraceSummary)
	order := make([]string, 0)

	for _, s := range spans {
		if s == nil || s.TraceID == "" {
			continue
		}
		ts, exists := traces[s.TraceID]
		if !exists {
			ts = &model.TraceSummary{
				TraceID:      s.TraceID,
				TenantID:     s.TenantID,
				RootSpanName: s.Name,
				StartTime:    s.StartTime,
				DurationMs:   s.DurationMs,
				SpanCount:    1,
				StatusCode:   s.StatusCode,
			}
			traces[s.TraceID] = ts
			order = append(order, s.TraceID)
		} else {
			ts.SpanCount++
			if s.StartTime.Before(ts.StartTime) {
				ts.StartTime = s.StartTime
				ts.RootSpanName = s.Name
			}
			if s.DurationMs > ts.DurationMs {
				ts.DurationMs = s.DurationMs
			}
			if s.StatusCode == model.StatusCodeError {
				ts.StatusCode = model.StatusCodeError
			}
		}
	}

	result := make([]*model.TraceSummary, 0, len(order))
	for _, tid := range order {
		result = append(result, traces[tid])
	}
	return result
}
