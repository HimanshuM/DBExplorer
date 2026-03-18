package driver

import (
	"fmt"
	"sort"
	"sync"

	"dbx/internal/domain"
)

type Registry struct {
	mu        sync.RWMutex
	factories map[domain.ConnectionKind]DriverFactory
}

func NewRegistry() *Registry {
	return &Registry{factories: make(map[domain.ConnectionKind]DriverFactory)}
}

func (r *Registry) Register(factory DriverFactory) error {
	if factory == nil {
		return fmt.Errorf("driver factory cannot be nil")
	}

	kind := factory.Kind()
	if kind == "" {
		return fmt.Errorf("driver factory kind cannot be empty")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.factories[kind]; exists {
		return fmt.Errorf("driver factory already registered for kind %q", kind)
	}

	r.factories[kind] = factory
	return nil
}

func (r *Registry) Get(kind domain.ConnectionKind) (DriverFactory, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	factory, ok := r.factories[kind]
	return factory, ok
}

func (r *Registry) MustGet(kind domain.ConnectionKind) DriverFactory {
	factory, ok := r.Get(kind)
	if !ok {
		panic(fmt.Sprintf("driver factory not found for kind %q", kind))
	}
	return factory
}

func (r *Registry) List() []DriverFactory {
	r.mu.RLock()
	defer r.mu.RUnlock()

	kinds := make([]domain.ConnectionKind, 0, len(r.factories))
	for kind := range r.factories {
		kinds = append(kinds, kind)
	}
	sort.Slice(kinds, func(i, j int) bool { return kinds[i] < kinds[j] })

	out := make([]DriverFactory, 0, len(kinds))
	for _, kind := range kinds {
		out = append(out, r.factories[kind])
	}
	return out
}
