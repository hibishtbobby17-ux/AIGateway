package pipeline_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"AIGateway/internal/observability/model"
	"AIGateway/internal/observability/pipeline"
	"AIGateway/internal/observability/storage"
)

type mockTraceStore struct {
	mu    sync.Mutex
	spans []*model.Span
}

func (m *mockTraceStore) StoreSpans(ctx context.Context, spans []*model.Span) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = append(m.spans, spans...)
	return nil
}

func (m *mockTraceStore) QuerySpans(ctx context.Context, filter storage.TraceFilter) ([]*model.Span, error) {
	return nil, nil
}

func (m *mockTraceStore) GetTrace(ctx context.Context, tenantID, traceID string) ([]*model.Span, error) {
	return nil, nil
}

func (m *mockTraceStore) GetTraceSummaries(ctx context.Context, filter storage.TraceFilter) ([]*model.TraceSummary, error) {
	return nil, nil
}

func (m *mockTraceStore) GetObservedTopology(ctx context.Context, tenantID string, startTime, endTime time.Time) (*model.ObservedTopology, error) {
	return nil, nil
}

func (m *mockTraceStore) GetMetricsSummary(ctx context.Context, tenantID string, startTime, endTime time.Time) (*model.MetricsSummary, error) {
	return nil, nil
}


func TestPipeline_BatchFlushAndRedaction(t *testing.T) {
	mockStore := &mockTraceStore{}
	memLogs := storage.NewMemoryStore(100)

	pipe := pipeline.NewPipeline(mockStore, memLogs, pipeline.Config{
		Capacity:      1000,
		BatchSize:     10,
		FlushInterval: 50 * time.Millisecond,
	})
	defer pipe.Close()

	// Enqueue spans
	for i := 0; i < 5; i++ {
		pipe.EnqueueSpan(&model.Span{
			SpanID:   "span-test",
			TenantID: "tenant-a",
			Attributes: map[string]any{
				"authorization": "Bearer super-secret",
				"clean_key":     "ok",
			},
		})
	}

	// Wait for ticker flush
	time.Sleep(120 * time.Millisecond)

	mockStore.mu.Lock()
	count := len(mockStore.spans)
	firstSpan := mockStore.spans[0]
	mockStore.mu.Unlock()

	if count != 5 {
		t.Fatalf("expected 5 spans flushed, got %d", count)
	}
	if firstSpan.Attributes["authorization"] != "[REDACTED]" {
		t.Errorf("expected authorization to be redacted, got %v", firstSpan.Attributes["authorization"])
	}
}

func TestPipeline_LoadSheddingUnderOverload(t *testing.T) {
	mockStore := &mockTraceStore{}
	memLogs := storage.NewMemoryStore(100)

	// Pipeline with tiny capacity of 5
	pipe := pipeline.NewPipeline(mockStore, memLogs, pipeline.Config{
		Capacity:      5,
		BatchSize:     50,
		FlushInterval: 10 * time.Second, // Long flush interval so buffer stays full
	})
	defer pipe.Close()

	// Flood pipeline with 100 spans
	for i := 0; i < 100; i++ {
		pipe.EnqueueSpan(&model.Span{
			SpanID:   "flood-span",
			TenantID: "tenant-a",
		})
	}

	ingested, dropped, _, _ := pipe.Stats()
	if dropped == 0 {
		t.Fatal("expected dropped spans under overload, got 0")
	}
	if ingested+dropped != 100 {
		t.Errorf("ingested (%d) + dropped (%d) != 100", ingested, dropped)
	}
}

func TestRatioSampler_ErrorAlwaysSampled(t *testing.T) {
	sampler := pipeline.NewRatioSampler(0.0) // 0% sampling for normal spans

	normalSpan := &model.Span{
		SpanID:     "s1",
		TraceID:    "trace-1",
		StatusCode: model.StatusCodeOk,
	}
	errorSpan := &model.Span{
		SpanID:     "s2",
		TraceID:    "trace-2",
		StatusCode: model.StatusCodeError,
	}

	if sampler.ShouldSample(normalSpan) {
		t.Error("0% sampler should not sample normal span")
	}
	if !sampler.ShouldSample(errorSpan) {
		t.Error("error span must always be sampled regardless of ratio")
	}
}
