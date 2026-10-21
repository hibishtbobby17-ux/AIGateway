package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSpoolerNormalBatchFlush(t *testing.T) {
	var receivedCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/ingest/v1/logs" {
			var events []LogEvent
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &events); err == nil {
				atomic.AddInt32(&receivedCount, int32(len(events)))
			}
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	tempDir := t.TempDir()
	spoolFile := filepath.Join(tempDir, "test_events.spool")

	spooler := NewSpooler(SpoolerConfig{
		IngestURL:     server.URL,
		SpoolFilePath: spoolFile,
		BatchSize:     5,
		FlushInterval: 100 * time.Millisecond,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	defer spooler.Close()

	for i := 0; i < 10; i++ {
		spooler.Emit(LogEvent{
			EventID:   "ev-" + string(rune('a'+i)),
			Project:   "test-proj",
			Status:    "200",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	}

	time.Sleep(300 * time.Millisecond)

	count := atomic.LoadInt32(&receivedCount)
	if count != 10 {
		t.Fatalf("expected 10 events received by server, got %d", count)
	}

	// Verify no spool file remains
	info, err := os.Stat(spoolFile)
	if err == nil && info.Size() > 0 {
		t.Fatalf("expected spool file to be empty or non-existent, size=%d", info.Size())
	}
}

func TestSpoolerOutageAndDrain(t *testing.T) {
	var isOnline atomic.Bool
	var receivedMu sync.Mutex
	var receivedEvents []LogEvent

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isOnline.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == "/ingest/v1/logs" {
			var events []LogEvent
			body, _ := io.ReadAll(r.Body)
			if err := json.Unmarshal(body, &events); err == nil {
				receivedMu.Lock()
				receivedEvents = append(receivedEvents, events...)
				receivedMu.Unlock()
			}
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// 1. Ingest starts OFFLINE
	isOnline.Store(false)

	tempDir := t.TempDir()
	spoolFile := filepath.Join(tempDir, "test_outage.spool")

	spooler := NewSpooler(SpoolerConfig{
		IngestURL:     server.URL,
		SpoolFilePath: spoolFile,
		BatchSize:     3,
		FlushInterval: 50 * time.Millisecond,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	// Emit events while server is offline
	for i := 0; i < 6; i++ {
		spooler.Emit(LogEvent{
			EventID:   "spooled-" + string(rune('a'+i)),
			Project:   "outage-proj",
			Status:    "200",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	}

	// Wait for flusher to attempt and spool to disk
	time.Sleep(250 * time.Millisecond)

	// Check that spool file exists and has content
	info, err := os.Stat(spoolFile)
	if err != nil || info.Size() == 0 {
		t.Fatalf("expected spool file to contain spooled events during outage")
	}

	receivedMu.Lock()
	countBefore := len(receivedEvents)
	receivedMu.Unlock()
	if countBefore != 0 {
		t.Fatalf("expected 0 events received during outage, got %d", countBefore)
	}

	// 2. Bring Ingest ONLINE
	isOnline.Store(true)

	// Trigger drain or wait for drainer loop (runs every 1s)
	spooler.drainSpoolOnce()

	time.Sleep(200 * time.Millisecond)

	receivedMu.Lock()
	countAfter := len(receivedEvents)
	receivedMu.Unlock()

	if countAfter != 6 {
		t.Fatalf("expected 6 events recovered and flushed after outage, got %d", countAfter)
	}

	// Spool file should now be drained (0 bytes)
	info, err = os.Stat(spoolFile)
	if err == nil && info.Size() > 0 {
		t.Fatalf("expected spool file to be drained to 0 bytes, got %d", info.Size())
	}

	spooler.Close()
}
