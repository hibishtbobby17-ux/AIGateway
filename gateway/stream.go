package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// startSSEStream continuously subscribes to the Server-Sent Events push stream
func (g *Gateway) startSSEStream(ctx context.Context) {
	if g.logger == nil {
		g.logger = slog.Default()
	}

	streamURL := fmt.Sprintf("%s/api/v1/gateways/sync/stream", g.consoleURL)
	g.logger.Info("starting real-time SSE stream listener", "url", streamURL)

	backoff := 1 * time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		token, err := g.getToken()
		if err != nil {
			time.Sleep(backoff)
			continue
		}

		req, err := http.NewRequestWithContext(ctx, "GET", streamURL, nil)
		if err != nil {
			time.Sleep(backoff)
			continue
		}

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Gateway-ID", g.gatewayID)
		req.Header.Set("Accept", "text/event-stream")

		currCfg := g.currentCfg.Load()
		if currCfg != nil && currCfg.Version > 0 {
			req.Header.Set("Last-Event-ID", fmt.Sprintf("v%d", currCfg.Version))
		}

		resp, err := g.httpClient.Do(req)
		if err != nil {
			g.logger.Debug("SSE stream connection attempt failed, will retry", "error", err)
			time.Sleep(backoff)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			g.logger.Debug("SSE stream endpoint returned non-200", "status", resp.StatusCode)
			time.Sleep(backoff)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		// Reset backoff upon successful connection
		backoff = 1 * time.Second
		g.logger.Info("connected to real-time control plane SSE stream", "gateway_id", g.gatewayID)

		reader := bufio.NewReader(resp.Body)
		var currentEvent, currentID string

		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				_ = resp.Body.Close()
				break
			}

			line = strings.TrimSpace(line)
			if line == "" {
				currentEvent = ""
				continue
			}

			if strings.HasPrefix(line, "event:") {
				currentEvent = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			} else if strings.HasPrefix(line, "id:") {
				currentID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
			} else if strings.HasPrefix(line, "data:") {
				dataStr := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				g.handleSSEEvent(currentEvent, currentID, dataStr)
			}
		}

		time.Sleep(2 * time.Second)
	}
}

func (g *Gateway) handleSSEEvent(event, id, data string) {
	if event == "ping" {
		return
	}

	g.logger.Info("received control plane event", "event", event, "id", id)

	if event == "route_upsert" || event == "guardrail_update" || event == "key_rotation" {
		var payload struct {
			Action   string         `json:"action"`
			Version  string         `json:"version"`
			Snapshot *GatewayConfig `json:"snapshot,omitempty"`
		}
		if err := json.Unmarshal([]byte(data), &payload); err == nil && payload.Snapshot != nil {
			g.currentCfg.Store(payload.Snapshot)
			_ = g.saveLocalConfig(payload.Snapshot)
			g.logger.Info("applied live configuration update from stream", "version", payload.Snapshot.Version)
		}
	}
}
