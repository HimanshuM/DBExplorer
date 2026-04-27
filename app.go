package main

import (
	"context"
	"sync"
)

type App struct {
	mu  sync.RWMutex
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.mu.Unlock()
}

func (a *App) context() context.Context {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.ctx
}
