package pipeline

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"sync"
	"sync/atomic"
	"time"

	"AIGateway/internal/observability/model"
	"AIGateway/internal/observability/redaction"
	"AIGateway/internal/observability/storage"
)

// Sampler determines whether a span should be sampled for persistence.
type Sampler interface {
	ShouldSample(span *model.Span) bool
}

// AlwaysSampler samples 100% of all spans.
type AlwaysSampler struct{}

func (s AlwaysSampler) ShouldSample(span *model.Span) bool { return true }

// RatioSampler samples errors at 100% and non-errors according to a ratio (0.0 - 1.0).
type RatioSampler struct {
	rate float64
}

// NewRatioSampler creates a ratio sampler.
func NewRatioSampler(rate float64) *RatioSampler {
	if rate < 0 {
		rate = 0
	} else if rate > 1 {
		rate = 1
	}
	return &RatioSampler{rate: rate}
}

func (s *RatioSampler) ShouldSample(span *model.Span) bool {
	if span == nil {
		return false
	}
	if span.StatusCode == model.StatusCodeError {
		return true // Always sample errors
	}
	if s.rate >= 1.0 {
		return true
	}
	if s.rate <= 0.0 {
		return false
	}

	// Deterministic sampling based on trace ID hash
	h := sha256.Sum256([]byte(span.TraceID))
	val := binary.BigEndian.Uint64(h[:8])
	threshold := uint64(s.rate * float64(^uint64(0)))
	return val < threshold
}

// Config holds pipeline buffering, batching, and worker configuration.
type Config struct {
	Capacity      int           // Ring buffer channel capacity (default: 10,000)
	BatchSize     int           // Maximum batch size flushed to storage (default: 100)
	FlushInterval time.Duration // Maximum flush interval (default: 200ms)
	FlushTimeout  time.Duration // Timeout for flushing batch to storage (default: 3s)
	Sampler       Sampler
	Redactor      *redaction.Redactor
}

// Pipeline coordinates non-blocking asynchronous buffering, redaction, and batch storage.
type Pipeline struct {
	cfg          Config
	traceStore   storage.TraceStore
	logStore     storage.LogStore
	spanChan     chan *model.Span
	logChan      chan *model.LogRecord
	stopChan     chan struct{}
	doneWg       sync.WaitGroup
	droppedSpans uint64
	droppedLogs  uint64
	ingestSpans  uint64
	ingestLogs   uint64
}

// NewPipeline creates and starts an asynchronous telemetry pipeline.
func NewPipeline(traceStore storage.TraceStore, logStore storage.LogStore, cfg Config) *Pipeline {
	if cfg.Capacity <= 0 {
		cfg.Capacity = 10000
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 200 * time.Millisecond
	}
	if cfg.FlushTimeout <= 0 {
		cfg.FlushTimeout = 3 * time.Second
	}
	if cfg.Sampler == nil {
		cfg.Sampler = AlwaysSampler{}
	}
	if cfg.Redactor == nil {
		cfg.Redactor = redaction.NewRedactor()
	}

	p := &Pipeline{
		cfg:        cfg,
		traceStore: traceStore,
		logStore:   logStore,
		spanChan:   make(chan *model.Span, cfg.Capacity),
		logChan:    make(chan *model.LogRecord, cfg.Capacity),
		stopChan:   make(chan struct{}),
	}

	p.doneWg.Add(2)
	go p.spanWorker()
	go p.logWorker()

	return p
}

// EnqueueSpan non-blockingly pushes a span to the buffer. If buffer is full, drops span.
func (p *Pipeline) EnqueueSpan(span *model.Span) {
	if span == nil {
		return
	}
	if !p.cfg.Sampler.ShouldSample(span) {
		return
	}

	select {
	case p.spanChan <- span:
		atomic.AddUint64(&p.ingestSpans, 1)
	default:
		// Ring buffer full: load shedding to protect gateway
		atomic.AddUint64(&p.droppedSpans, 1)
	}
}

// EnqueueLog non-blockingly pushes a log record to the buffer.
func (p *Pipeline) EnqueueLog(log *model.LogRecord) {
	if log == nil {
		return
	}

	select {
	case p.logChan <- log:
		atomic.AddUint64(&p.ingestLogs, 1)
	default:
		atomic.AddUint64(&p.droppedLogs, 1)
	}
}

func (p *Pipeline) spanWorker() {
	defer p.doneWg.Done()
	ticker := time.NewTicker(p.cfg.FlushInterval)
	defer ticker.Stop()

	batch := make([]*model.Span, 0, p.cfg.BatchSize)

	flush := func() {
		if len(batch) == 0 || p.traceStore == nil {
			batch = batch[:0]
			return
		}

		// Apply redaction before storing
		for _, s := range batch {
			p.cfg.Redactor.RedactSpan(s)
		}

		ctx, cancel := context.WithTimeout(context.Background(), p.cfg.FlushTimeout)
		_ = p.traceStore.StoreSpans(ctx, batch)
		cancel()

		batch = make([]*model.Span, 0, p.cfg.BatchSize)
	}

	for {
		select {
		case <-p.stopChan:
			// Drain remaining items
			for {
				select {
				case s := <-p.spanChan:
					batch = append(batch, s)
					if len(batch) >= p.cfg.BatchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}

		case s := <-p.spanChan:
			batch = append(batch, s)
			if len(batch) >= p.cfg.BatchSize {
				flush()
			}

		case <-ticker.C:
			if len(batch) > 0 {
				flush()
			}
		}
	}
}

func (p *Pipeline) logWorker() {
	defer p.doneWg.Done()
	ticker := time.NewTicker(p.cfg.FlushInterval)
	defer ticker.Stop()

	batch := make([]*model.LogRecord, 0, p.cfg.BatchSize)

	flush := func() {
		if len(batch) == 0 || p.logStore == nil {
			batch = batch[:0]
			return
		}

		for _, l := range batch {
			p.cfg.Redactor.RedactLog(l)
		}

		ctx, cancel := context.WithTimeout(context.Background(), p.cfg.FlushTimeout)
		_ = p.logStore.StoreLogs(ctx, batch)
		cancel()

		batch = make([]*model.LogRecord, 0, p.cfg.BatchSize)
	}

	for {
		select {
		case <-p.stopChan:
			for {
				select {
				case l := <-p.logChan:
					batch = append(batch, l)
					if len(batch) >= p.cfg.BatchSize {
						flush()
					}
				default:
					flush()
					return
				}
			}

		case l := <-p.logChan:
			batch = append(batch, l)
			if len(batch) >= p.cfg.BatchSize {
				flush()
			}

		case <-ticker.C:
			if len(batch) > 0 {
				flush()
			}
		}
	}
}

// Stats returns operational counters for the pipeline.
func (p *Pipeline) Stats() (ingestedSpans, droppedSpans, ingestedLogs, droppedLogs uint64) {
	return atomic.LoadUint64(&p.ingestSpans),
		atomic.LoadUint64(&p.droppedSpans),
		atomic.LoadUint64(&p.ingestLogs),
		atomic.LoadUint64(&p.droppedLogs)
}

// Close gracefully terminates pipeline workers and flushes remaining buffers.
func (p *Pipeline) Close() error {
	close(p.stopChan)
	p.doneWg.Wait()
	return nil
}
