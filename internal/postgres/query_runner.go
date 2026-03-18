package postgres

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type QueryRunner struct {
	profile        domain.ConnProfile
	sessionManager *SessionManager
	jobCounter     uint64
	mu             sync.RWMutex
	jobs           map[domain.JobID]*jobState
}

type jobState struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
	summary    domain.JobSummary
	schema     domain.ResultSchema
	rows       [][]any
}

type jobHandle struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
}

func NewQueryRunner(profile domain.ConnProfile, sm *SessionManager) *QueryRunner {
	return &QueryRunner{profile: profile, sessionManager: sm, jobs: make(map[domain.JobID]*jobState)}
}

func (qr *QueryRunner) RunQuery(ctx context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
	session, err := qr.sessionManager.AcquireDedicatedSession(ctx, req.Database)
	if err != nil {
		return nil, fmt.Errorf("acquire dedicated session: %w", err)
	}

	si := session.Info()
	next := atomic.AddUint64(&qr.jobCounter, 1)
	jobID := domain.JobID(fmt.Sprintf("job_%d", next))
	now := time.Now().UnixMilli()

	summary := domain.JobSummary{
		JobID:     jobID,
		ProfileID: req.ProfileID,
		Database:  req.Database,
		Status:    domain.JobCompleted,
		StartedAt: now,
		EndedAt:   now,
		ResultSets: []domain.ResultSetSummary{{
			ResultSetID:    domain.ResultSetID("rs_1"),
			StatementIndex: 0,
			CommandTag:     "SELECT",
			RowsAffected:   2,
			RowCountKnown:  true,
			RowCount:       2,
		}},
	}

	schema := domain.ResultSchema{Columns: []domain.ColumnDef{{
		Name:     "message",
		Type:     domain.ColumnType{DBTypeName: "text", Category: "string", IsArray: false, Nullable: false},
		Nullable: false,
	}}}

	rows := [][]any{
		{"Postgres query runner stub is wired"},
		{"Next step is real pgx execution"},
	}

	state := &jobState{id: jobID, sessionID: si.ID, backendPID: si.BackendPID, summary: summary, schema: schema, rows: rows}

	qr.mu.Lock()
	qr.jobs[jobID] = state
	qr.mu.Unlock()

	return &jobHandle{id: jobID, sessionID: si.ID, backendPID: si.BackendPID}, nil
}

func (qr *QueryRunner) CancelJob(ctx context.Context, jobID domain.JobID) error {
	_ = ctx
	qr.mu.Lock()
	defer qr.mu.Unlock()

	job, ok := qr.jobs[jobID]
	if !ok {
		return fmt.Errorf("job %q not found", jobID)
	}

	job.summary.Status = domain.JobCanceled
	job.summary.EndedAt = time.Now().UnixMilli()
	return nil
}

func (qr *QueryRunner) GetJob(ctx context.Context, jobID domain.JobID) (domain.JobSummary, error) {
	_ = ctx
	qr.mu.RLock()
	defer qr.mu.RUnlock()

	job, ok := qr.jobs[jobID]
	if !ok {
		return domain.JobSummary{}, fmt.Errorf("job %q not found", jobID)
	}
	return job.summary, nil
}

func (qr *QueryRunner) GetResultSchema(ctx context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	_ = ctx
	qr.mu.RLock()
	defer qr.mu.RUnlock()

	job, ok := qr.jobs[req.JobID]
	if !ok {
		return domain.ResultSchema{}, fmt.Errorf("job %q not found", req.JobID)
	}
	return job.schema, nil
}

func (qr *QueryRunner) GetRows(ctx context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	_ = ctx
	qr.mu.RLock()
	defer qr.mu.RUnlock()

	job, ok := qr.jobs[req.JobID]
	if !ok {
		return domain.GetRowsResponse{}, fmt.Errorf("job %q not found", req.JobID)
	}

	start := req.Start
	if start < 0 {
		start = 0
	}
	if start > len(job.rows) {
		start = len(job.rows)
	}

	count := req.Count
	if count < 0 {
		count = 0
	}

	end := start + count
	if end > len(job.rows) {
		end = len(job.rows)
	}

	paged := make([][]any, end-start)
	copy(paged, job.rows[start:end])

	return domain.GetRowsResponse{Start: start, Rows: paged, RowCountKnown: true, RowCount: int64(len(job.rows))}, nil
}

func (qr *QueryRunner) DisposeJob(ctx context.Context, jobID domain.JobID) error {
	_ = ctx

	var sessionID domain.SessionID
	qr.mu.Lock()
	if job, ok := qr.jobs[jobID]; ok {
		sessionID = job.sessionID
		delete(qr.jobs, jobID)
	}
	qr.mu.Unlock()

	if sessionID == "" {
		return nil
	}

	return qr.sessionManager.ReleaseDedicatedSession(context.Background(), sessionID)
}

func (h *jobHandle) ID() domain.JobID {
	return h.id
}

func (h *jobHandle) SessionID() domain.SessionID {
	return h.sessionID
}

func (h *jobHandle) BackendPID() int {
	return h.backendPID
}
