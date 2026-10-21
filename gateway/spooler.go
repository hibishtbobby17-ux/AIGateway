package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type SpoolerConfig struct {
	IngestURL         string
	SpoolFilePath     string
	BatchSize         int
	FlushInterval     time.Duration
	MaxSpoolSizeBytes int64
	QueueCapacity     int
	Logger            *slog.Logger
	HTTPClient        *http.Client
}

type Spooler struct {
	cfg       SpoolerConfig
	eventChan chan LogEvent
	spoolMu   sync.Mutex
	stopChan  chan struct{}
	wg        sync.WaitGroup
	logger    *slog.Logger
	client    *http.Client
	spoolPath string
}

func NewSpooler(cfg SpoolerConfig) *Spooler {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 25
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 500 * time.Millisecond
	}
	if cfg.MaxSpoolSizeBytes <= 0 {
		cfg.MaxSpoolSizeBytes = 20 * 1024 * 1024 // 20MB
	}
	if cfg.QueueCapacity <= 0 {
		cfg.QueueCapacity = 5000
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 3 * time.Second}
	}

	spoolPath := cfg.SpoolFilePath
	if spoolPath == "" {
		spoolPath = os.Getenv("SPOOL_FILE_PATH")
	}
	if spoolPath == "" {
		spoolPath = filepath.Join(os.TempDir(), "gateway_events.spool")
	}

	// Ensure parent directory exists
	_ = os.MkdirAll(filepath.Dir(spoolPath), 0755)

	s := &Spooler{
		cfg:       cfg,
		eventChan: make(chan LogEvent, cfg.QueueCapacity),
		stopChan:  make(chan struct{}),
		logger:    cfg.Logger,
		client:    cfg.HTTPClient,
		spoolPath: spoolPath,
	}

	s.wg.Add(2)
	go s.flusherLoop()
	go s.diskDrainerLoop()

	s.logger.Info("initialized gateway log spooler",
		"ingest_url", cfg.IngestURL,
		"batch_size", cfg.BatchSize,
		"flush_interval", cfg.FlushInterval,
		"spool_path", spoolPath,
	)

	return s
}

// Emit queues an event into the in-memory ring buffer or directly spools to disk if full
func (s *Spooler) Emit(event LogEvent) {
	select {
	case s.eventChan <- event:
	default:
		// Ring buffer full: fail-safe spool directly to disk
		s.logger.Warn("spooler in-memory queue full, spilling directly to disk", "event_id", event.EventID)
		s.spoolToDisk([]LogEvent{event})
	}
}

// SpoolFilePath returns the configured spool path
func (s *Spooler) SpoolFilePath() string {
	return s.spoolPath
}

// flusherLoop batches in-memory events and attempts to flush to Ingest
func (s *Spooler) flusherLoop() {
	defer s.wg.Done()

	ticker := time.NewTicker(s.cfg.FlushInterval)
	defer ticker.Stop()

	var batch []LogEvent

	flush := func() {
		if len(batch) == 0 {
			return
		}
		currentBatch := batch
		batch = nil

		if err := s.sendBatch(currentBatch); err != nil {
			s.logger.Warn("failed to send log batch to ingest, spooling to disk", "error", err, "count", len(currentBatch))
			s.spoolToDisk(currentBatch)
		}
	}

	for {
		select {
		case <-s.stopChan:
			// Drain remaining events from channel
			for {
				select {
				case ev := <-s.eventChan:
					batch = append(batch, ev)
				default:
					flush()
					return
				}
			}

		case ev := <-s.eventChan:
			batch = append(batch, ev)
			if len(batch) >= s.cfg.BatchSize {
				flush()
			}

		case <-ticker.C:
			flush()
		}
	}
}

// sendBatch transmits an array of LogEvents to the Ingest service via HTTP POST
func (s *Spooler) sendBatch(events []LogEvent) error {
	if len(events) == 0 {
		return nil
	}

	payload, err := json.Marshal(events)
	if err != nil {
		return fmt.Errorf("marshal log batch error: %w", err)
	}

	req, err := http.NewRequest("POST", s.cfg.IngestURL+"/ingest/v1/logs", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("create ingest request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("ingest request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("ingest returned unexpected status: %d", resp.StatusCode)
	}

	return nil
}

// spoolToDisk appends events as JSON lines to the disk spool file with size cap enforcement
func (s *Spooler) spoolToDisk(events []LogEvent) {
	if len(events) == 0 {
		return
	}

	s.spoolMu.Lock()
	defer s.spoolMu.Unlock()

	f, err := os.OpenFile(s.spoolPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		s.logger.Error("failed to open spool file for writing", "error", err, "path", s.spoolPath)
		return
	}
	defer f.Close()

	for _, ev := range events {
		data, err := json.Marshal(ev)
		if err == nil {
			_, _ = f.Write(data)
			_, _ = f.WriteString("\n")
		}
	}
	_ = f.Sync()

	// Check and enforce spool size cap
	info, err := f.Stat()
	if err == nil && info.Size() > s.cfg.MaxSpoolSizeBytes {
		s.logger.Warn("spool file exceeded max size cap, rotating/truncating", "size", info.Size(), "cap", s.cfg.MaxSpoolSizeBytes)
		s.enforceSpoolCap()
	}
}

// enforceSpoolCap retains the latest portion of events when spool file exceeds size cap
func (s *Spooler) enforceSpoolCap() {
	lines, err := s.readAllSpoolLines()
	if err != nil || len(lines) == 0 {
		return
	}

	// Keep last 50% of lines
	keepFrom := len(lines) / 2
	kept := lines[keepFrom:]

	f, err := os.OpenFile(s.spoolPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	for _, line := range kept {
		_, _ = f.WriteString(line + "\n")
	}
	_ = f.Sync()
}

// diskDrainerLoop periodically checks if Ingest has recovered and drains the disk spool file
func (s *Spooler) diskDrainerLoop() {
	defer s.wg.Done()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			return
		case <-ticker.C:
			s.drainSpoolOnce()
		}
	}
}

// drainSpoolOnce probes Ingest health and flushes spooled lines if online
func (s *Spooler) drainSpoolOnce() {
	s.spoolMu.Lock()
	defer s.spoolMu.Unlock()

	info, err := os.Stat(s.spoolPath)
	if err != nil || info.Size() == 0 {
		return
	}

	// 1. Probe Ingest health
	healthReq, err := http.NewRequest("GET", s.cfg.IngestURL+"/healthz", nil)
	if err != nil {
		return
	}

	healthResp, err := s.client.Do(healthReq)
	if err != nil {
		// Ingest still unreachable
		return
	}
	_ = healthResp.Body.Close()

	if healthResp.StatusCode != http.StatusOK {
		return
	}

	// 2. Read lines from spool file
	lines, err := s.readAllSpoolLines()
	if err != nil || len(lines) == 0 {
		return
	}

	// 3. Process lines in chunks of up to 100 events
	chunkSize := 100
	if len(lines) < chunkSize {
		chunkSize = len(lines)
	}

	var eventsToSend []LogEvent
	for i := 0; i < chunkSize; i++ {
		var ev LogEvent
		if err := json.Unmarshal([]byte(lines[i]), &ev); err == nil {
			eventsToSend = append(eventsToSend, ev)
		}
	}

	if len(eventsToSend) > 0 {
		if err := s.sendBatch(eventsToSend); err != nil {
			s.logger.Warn("spool drain attempt failed against ingest", "error", err)
			return
		}

		s.logger.Info("successfully flushed spooled events to ingest", "count", len(eventsToSend))

		// 4. Rewrite spool file with remaining lines
		remainingLines := lines[chunkSize:]
		f, err := os.OpenFile(s.spoolPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err == nil {
			for _, line := range remainingLines {
				_, _ = f.WriteString(line + "\n")
			}
			_ = f.Sync()
			_ = f.Close()
		}
	}
}

func (s *Spooler) readAllSpoolLines() ([]string, error) {
	f, err := os.Open(s.spoolPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		text := scanner.Text()
		if len(text) > 0 {
			lines = append(lines, text)
		}
	}
	return lines, scanner.Err()
}

// Close gracefully stops the spooler and flushes in-memory queues
func (s *Spooler) Close() {
	close(s.stopChan)
	s.wg.Wait()
}
