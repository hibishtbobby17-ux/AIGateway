package load_test

import (
	"math"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"AIGateway/internal/resilience"
)

func TestHighConcurrencyLoadAndBoundedMemory(t *testing.T) {
	// 1. Setup mock resilient service with rate limiter and bulkhead
	bulkhead := resilience.NewBulkhead(50)
	limiter := resilience.NewRateLimiter(resilience.RateLimiterConfig{
		RequestsPerMinute: 60000, // High throughput for benchmark
		Burst:             100,
	})

	handler := resilience.RateLimitMiddleware(limiter, func(r *http.Request) string {
		return "tenant-load-test"
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if err := bulkhead.Acquire(ctx); err != nil {
			http.Error(w, "bulkhead limit reached", http.StatusServiceUnavailable)
			return
		}
		defer bulkhead.Release()

		// Simulate slight compute latency (1-3ms)
		time.Sleep(2 * time.Millisecond)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))

	server := httptest.NewServer(handler)
	defer server.Close()

	// 2. Measure baseline memory
	runtime.GC()
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	// 3. High-concurrency workload parameters
	const (
		totalRequests = 1000
		concurrency   = 50
	)

	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 50,
			IdleConnTimeout:     30 * time.Second,
		},
	}

	var (
		successCount int64
		errorCount   int64
		latenciesMu  sync.Mutex
		latencies    []time.Duration
	)

	reqChan := make(chan struct{}, totalRequests)
	for i := 0; i < totalRequests; i++ {
		reqChan <- struct{}{}
	}
	close(reqChan)

	start := time.Now()
	var wg sync.WaitGroup

	// Launch concurrent workers
	for w := 0; w < concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range reqChan {
				reqStart := time.Now()
				req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
				req.Header.Set("X-Tenant-ID", "tenant-load-test")

				resp, err := client.Do(req)
				elapsed := time.Since(reqStart)

				if err == nil && resp.StatusCode == http.StatusOK {
					atomic.AddInt64(&successCount, 1)
					resp.Body.Close()
				} else {
					atomic.AddInt64(&errorCount, 1)
					if resp != nil {
						resp.Body.Close()
					}
				}

				latenciesMu.Lock()
				latencies = append(latencies, elapsed)
				latenciesMu.Unlock()
			}
		}()
	}

	wg.Wait()
	totalDuration := time.Since(start)

	// 4. Memory check after load
	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)

	heapGrowthMB := float64(memAfter.HeapAlloc-memBefore.HeapAlloc) / (1024 * 1024)

	// 5. Calculate latency percentiles
	sort.Slice(latencies, func(i, j int) bool {
		return latencies[i] < latencies[j]
	})

	var p50, p95, p99 time.Duration
	if len(latencies) > 0 {
		p50 = latencies[int(math.Floor(float64(len(latencies))*0.50))]
		p95 = latencies[int(math.Floor(float64(len(latencies))*0.95))]
		p99 = latencies[int(math.Floor(float64(len(latencies))*0.99))]
	}

	rps := float64(totalRequests) / totalDuration.Seconds()

	t.Logf("=== Load Benchmark Results ===")
	t.Logf(" Total Requests  : %d", totalRequests)
	t.Logf(" Concurrency     : %d workers", concurrency)
	t.Logf(" Total Time      : %v", totalDuration)
	t.Logf(" Throughput      : %.2f req/sec", rps)
	t.Logf(" Successes       : %d (%.1f%%)", successCount, float64(successCount)/float64(totalRequests)*100.0)
	t.Logf(" Errors/Shed     : %d", errorCount)
	t.Logf(" Latency p50     : %v", p50)
	t.Logf(" Latency p95     : %v", p95)
	t.Logf(" Latency p99     : %v", p99)
	t.Logf(" Heap Growth     : %.2f MB", heapGrowthMB)

	// Assertions
	if successCount == 0 {
		t.Fatal("expected at least some successful requests during load test")
	}
	// Heap growth should remain bounded (less than 50MB for 1000 requests)
	if heapGrowthMB > 50.0 {
		t.Errorf("heap growth exceeded bound: %.2f MB", heapGrowthMB)
	}
}
