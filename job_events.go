package main

import (
	"context"

	"dbx/internal/domain"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type WailsJobEventEmitter struct {
	app *App
}

type JobResultSetEvent struct {
	Summary domain.JobSummary   `json:"summary"`
	Schema  domain.ResultSchema `json:"schema"`
}

func NewWailsJobEventEmitter(app *App) *WailsJobEventEmitter {
	return &WailsJobEventEmitter{app: app}
}

func (e *WailsJobEventEmitter) EmitQueued(_ context.Context, summary domain.JobSummary) {
	e.emit("job:queued", summary)
}

func (e *WailsJobEventEmitter) EmitStarted(_ context.Context, summary domain.JobSummary) {
	e.emit("job:started", summary)
}

func (e *WailsJobEventEmitter) EmitResultSet(_ context.Context, summary domain.JobSummary, schema domain.ResultSchema) {
	e.emit("job:resultset", JobResultSetEvent{Summary: summary, Schema: schema})
}

func (e *WailsJobEventEmitter) EmitCompleted(_ context.Context, summary domain.JobSummary) {
	e.emit("job:completed", summary)
}

func (e *WailsJobEventEmitter) EmitFailed(_ context.Context, summary domain.JobSummary) {
	e.emit("job:failed", summary)
}

func (e *WailsJobEventEmitter) EmitCanceled(_ context.Context, summary domain.JobSummary) {
	e.emit("job:canceled", summary)
}

func (e *WailsJobEventEmitter) emit(eventName string, payload any) {
	if e == nil || e.app == nil {
		return
	}
	ctx := e.app.context()
	if ctx == nil {
		return
	}
	runtime.EventsEmit(ctx, eventName, payload)
}
