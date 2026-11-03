// The example records one concrete schedule, not a fairness guarantee.
// Run: go run ./notes/go-sync-wait-wake/examples/waiters/main.go
// Optional: add -trace to create a new temporary runtime trace.
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"runtime/trace"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:noinline
func waitChannel(ch <-chan int, ready chan<- string, done chan<- string) {
	ready <- "channel"
	<-ch
	done <- "channel"
}

//go:noinline
func waitMutex(mu *sync.Mutex, ready chan<- string, done chan<- string) {
	ready <- "mutex"
	mu.Lock()
	mu.Unlock()
	done <- "mutex"
}

//go:noinline
func waitPermit(permits chan struct{}, ready chan<- string, done chan<- string) {
	ready <- "permit"
	permits <- struct{}{}
	<-permits
	done <- "permit"
}

type target struct {
	name   string
	reason string
}

func snapshotWaiters(targets []target, timeout time.Duration) (map[string]string, error) {
	deadline := time.Now().Add(timeout)
	buffer := make([]byte, 1<<20)
	for time.Now().Before(deadline) {
		n := runtime.Stack(buffer, true)
		if n == len(buffer) {
			return nil, fmt.Errorf("goroutine stack snapshot exceeded %d bytes", len(buffer))
		}
		found := make(map[string]string)
		for _, block := range strings.Split(string(buffer[:n]), "\n\n") {
			for _, want := range targets {
				// Test binaries can use a package path other than "main".
				marker := strings.TrimPrefix(want.name, "main.") + "("
				if strings.Contains(block, marker) && strings.Contains(block, want.reason) {
					found[want.name] = block
				}
			}
		}
		if len(found) == len(targets) {
			return found, nil
		}
		runtime.Gosched()
	}
	return nil, fmt.Errorf("could not observe %d waiting goroutines within %s", len(targets), timeout)
}

func run(captureTrace bool) (resultErr error) {
	if captureTrace {
		// CreateTemp chooses a fresh, private file without overwriting an existing trace.
		file, err := os.CreateTemp("", "go-sync-waiters-*.trace")
		if err != nil {
			return fmt.Errorf("create trace: %w", err)
		}
		if err := trace.Start(file); err != nil {
			if closeErr := file.Close(); closeErr != nil {
				return fmt.Errorf("start trace: %v; close trace: %w", err, closeErr)
			}
			return fmt.Errorf("start trace: %w", err)
		}
		fmt.Printf("trace: %s\n", file.Name())
		defer func() {
			trace.Stop()
			if err := file.Close(); err != nil && resultErr == nil {
				resultErr = fmt.Errorf("close trace: %w", err)
			}
		}()
	}

	channel := make(chan int)
	permits := make(chan struct{}, 1)
	permits <- struct{}{}
	var mu sync.Mutex
	mu.Lock()
	ready := make(chan string, 3)
	done := make(chan string, 3)
	go waitChannel(channel, ready, done)
	go waitMutex(&mu, ready, done)
	go waitPermit(permits, ready, done)
	for range 3 {
		<-ready
	}

	targets := []target{
		{"main.waitChannel", "[chan receive]"},
		{"main.waitMutex", "[sync.Mutex.Lock]"},
		{"main.waitPermit", "[chan send]"},
	}
	stacks, err := snapshotWaiters(targets, 5*time.Second)
	if err != nil {
		// Release all three waiters even when an observation fails.
		close(channel)
		mu.Unlock()
		<-permits
		return fmt.Errorf("observe waiting goroutines: %w", err)
	}

	fmt.Printf("Go %s %s/%s\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
	for _, want := range targets {
		fmt.Printf("\n%s\n", want.name)
		marker := strings.TrimPrefix(want.name, "main.") + "("
		for _, line := range strings.Split(stacks[want.name], "\n") {
			if strings.HasPrefix(line, "goroutine ") || strings.Contains(line, "SemacquireMutex") || strings.Contains(line, "lockSlow") || strings.Contains(line, marker) {
				fmt.Println(line)
			}
		}
	}

	// Each operation changes the condition that kept one goroutine waiting.
	channel <- 42
	mu.Unlock()
	<-permits
	resumed := []string{<-done, <-done, <-done}
	sort.Strings(resumed)
	fmt.Printf("\nresumed: %s\n", strings.Join(resumed, ", "))
	return nil
}

func main() {
	captureTrace := flag.Bool("trace", false, "write a runtime trace to a new temporary file")
	flag.Parse()
	if err := run(*captureTrace); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
