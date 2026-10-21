package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIngestHealthz(t *testing.T) {
	server := &IngestServer{
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		maxBodySize: 1048576,
	}

	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	server.handleHealthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var res map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if res["status"] != "ok" {
		t.Fatalf("expected status ok, got %v", res["status"])
	}
}

func TestIngestInvalidSchema(t *testing.T) {
	server := &IngestServer{
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		maxBodySize: 1048576,
	}

	req := httptest.NewRequest("POST", "/ingest/v1/logs", bytes.NewBufferString("not-json"))
	rec := httptest.NewRecorder()
	server.handleLogs(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request, got %d", rec.Code)
	}
}

func TestIngestNoUIRoutes(t *testing.T) {
	server := &IngestServer{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	testCases := []struct {
		method string
		target string
		want   int
	}{
		{"GET", "/", http.StatusMethodNotAllowed},
		{"GET", "/logs", http.StatusMethodNotAllowed},
		{"GET", "/ingest/v1/logs", http.StatusMethodNotAllowed},
		{"GET", "/admin", http.StatusMethodNotAllowed},
		{"POST", "/unknown-route", http.StatusNotFound},
	}

	for _, tc := range testCases {
		req := httptest.NewRequest(tc.method, tc.target, nil)
		rec := httptest.NewRecorder()
		server.handleCatchAll(rec, req)

		if rec.Code != tc.want {
			t.Errorf("%s %s: expected %d, got %d", tc.method, tc.target, tc.want, rec.Code)
		}
	}
}

