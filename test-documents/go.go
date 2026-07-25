// A self-contained worker pool that races goroutines to find perfect numbers.
//
// Exercises structs, interfaces, goroutines, channels, select, defer,
// error handling and table-driven style.
package main

import (
	"errors"
	"fmt"
	"sort"
	"sync"
)

// ErrOutOfRange is returned when a search bound makes no sense.
var ErrOutOfRange = errors.New("upper bound must exceed 1")

type Result struct {
	Number  int
	Divisors []int
}

type Searcher interface {
	Search(upper int) ([]Result, error)
}

type ParallelSearcher struct {
	Workers int
}

func divisorsOf(n int) []int {
	divisors := []int{1}
	for candidate := 2; candidate*candidate <= n; candidate++ {
		if n%candidate == 0 {
			divisors = append(divisors, candidate)
			if other := n / candidate; other != candidate {
				divisors = append(divisors, other)
			}
		}
	}
	sort.Ints(divisors)
	return divisors
}

func (p ParallelSearcher) Search(upper int) ([]Result, error) {
	if upper <= 1 {
		return nil, fmt.Errorf("search %d: %w", upper, ErrOutOfRange)
	}

	numbers := make(chan int)
	found := make(chan Result)
	var wg sync.WaitGroup

	for worker := 0; worker < p.Workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range numbers {
				divisors := divisorsOf(n)
				sum := 0
				for _, d := range divisors {
					sum += d
				}
				if sum == n {
					found <- Result{Number: n, Divisors: divisors}
				}
			}
		}()
	}

	go func() {
		for n := 2; n <= upper; n++ {
			numbers <- n
		}
		close(numbers)
		wg.Wait()
		close(found)
	}()

	var results []Result
	for result := range found {
		results = append(results, result)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Number < results[j].Number })
	return results, nil
}

func main() {
	searcher := ParallelSearcher{Workers: 4}
	results, err := searcher.Search(10000)
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	for _, result := range results {
		fmt.Printf("%d = sum of %v\n", result.Number, result.Divisors)
	}
}
