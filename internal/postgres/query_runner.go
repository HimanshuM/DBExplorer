package postgres

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

	h, ok := session.(*sessionHandle)
	if !ok {
		return nil, fmt.Errorf("internal session type assertion failed")
	}

	next := atomic.AddUint64(&qr.jobCounter, 1)
	jobID := domain.JobID(fmt.Sprintf("job_%d", next))
	started := time.Now().UnixMilli()

	summary := domain.JobSummary{
		JobID:      jobID,
		ProfileID:  req.ProfileID,
		Database:   h.info.Database,
		Status:     domain.JobRunning,
		StartedAt:  started,
		ResultSets: []domain.ResultSetSummary{},
	}

	state := &jobState{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID, summary: summary}

	rows, err := h.conn.Query(ctx, req.SQL)
	if err != nil {
		state.summary.Status = domain.JobFailed
		state.summary.EndedAt = time.Now().UnixMilli()
		state.summary.Error = &domain.JobError{Code: "query_error", Message: err.Error()}
		qr.mu.Lock()
		qr.jobs[jobID] = state
		qr.mu.Unlock()
		return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
	}
	defer rows.Close()

	fieldDescriptions := rows.FieldDescriptions()
	if len(fieldDescriptions) == 0 {
		rows.Close()
		if err := rows.Err(); err != nil {
			state.summary.Status = domain.JobFailed
			state.summary.EndedAt = time.Now().UnixMilli()
			state.summary.Error = &domain.JobError{Code: "query_error", Message: err.Error()}
		} else {
			tag := rows.CommandTag()
			state.summary.Status = domain.JobCompleted
			state.summary.EndedAt = time.Now().UnixMilli()
			state.summary.ResultSets = []domain.ResultSetSummary{{
				ResultSetID:    domain.ResultSetID("rs_1"),
				StatementIndex: 0,
				CommandTag:     tag.String(),
				RowsAffected:   tag.RowsAffected(),
				RowCountKnown:  true,
				RowCount:       0,
			}}
			state.schema = domain.ResultSchema{Columns: []domain.ColumnDef{}}
			state.rows = [][]any{}
		}
		qr.mu.Lock()
		qr.jobs[jobID] = state
		qr.mu.Unlock()
		return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
	}

	state.schema = buildSchema(fieldDescriptions, h.conn)
	state.rows = make([][]any, 0)

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			state.summary.Status = domain.JobFailed
			state.summary.EndedAt = time.Now().UnixMilli()
			state.summary.Error = &domain.JobError{Code: "row_decode_error", Message: err.Error()}
			qr.mu.Lock()
			qr.jobs[jobID] = state
			qr.mu.Unlock()
			return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
		}
		rowCopy := make([]any, len(vals))
		copy(rowCopy, vals)
		state.rows = append(state.rows, rowCopy)
	}

	if err := rows.Err(); err != nil {
		state.summary.Status = domain.JobFailed
		state.summary.EndedAt = time.Now().UnixMilli()
		state.summary.Error = &domain.JobError{Code: "query_error", Message: err.Error()}
		qr.mu.Lock()
		qr.jobs[jobID] = state
		qr.mu.Unlock()
		return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
	}

	state.summary.Status = domain.JobCompleted
	state.summary.EndedAt = time.Now().UnixMilli()
	state.summary.ResultSets = []domain.ResultSetSummary{{
		ResultSetID:    domain.ResultSetID("rs_1"),
		StatementIndex: 0,
		CommandTag:     "SELECT",
		RowsAffected:   int64(len(state.rows)),
		RowCountKnown:  true,
		RowCount:       int64(len(state.rows)),
	}}

	qr.mu.Lock()
	qr.jobs[jobID] = state
	qr.mu.Unlock()

	return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
}

func (qr *QueryRunner) CancelJob(ctx context.Context, jobID domain.JobID) error {
	qr.mu.RLock()
	job, ok := qr.jobs[jobID]
	qr.mu.RUnlock()
	if !ok {
		return fmt.Errorf("job %q not found", jobID)
	}
	if job.backendPID == 0 {
		return fmt.Errorf("job %q cannot be canceled: missing backend PID", jobID)
	}

	cfg, err := buildConnConfig(qr.profile, job.summary.Database)
	if err != nil {
		return err
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("open cancel connection: %w", err)
	}
	defer conn.Close(ctx)

	var canceled bool
	if err := conn.QueryRow(ctx, "select pg_cancel_backend($1)", job.backendPID).Scan(&canceled); err != nil {
		return fmt.Errorf("run pg_cancel_backend: %w", err)
	}
	if !canceled {
		return fmt.Errorf("cancel request was not confirmed for job %q (pid=%d)", jobID, job.backendPID)
	}

	qr.mu.Lock()
	if current, exists := qr.jobs[jobID]; exists {
		current.summary.Status = domain.JobCanceled
		current.summary.EndedAt = time.Now().UnixMilli()
	}
	qr.mu.Unlock()

	// TODO: True mid-flight cancellation requires async job execution with dedicated goroutines.
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

func buildSchema(fields []pgconn.FieldDescription, conn *pgx.Conn) domain.ResultSchema {
	columns := make([]domain.ColumnDef, 0, len(fields))
	for _, f := range fields {
		typeName := "unknown"
		if t, ok := conn.TypeMap().TypeForOID(f.DataTypeOID); ok && t != nil {
			typeName = t.Name
		}

		columns = append(columns, domain.ColumnDef{
			Name: string(f.Name),
			Type: domain.ColumnType{
				DBTypeName: typeName,
				Category:   categoryForType(typeName),
				IsArray:    false,
				Nullable:   true,
			},
			Nullable: true,
		})
	}
	return domain.ResultSchema{Columns: columns}
}

func categoryForType(dbTypeName string) string {
	t := strings.ToLower(dbTypeName)
	switch t {
	case "text", "varchar", "bpchar", "name", "uuid":
		return "text"
	case "int2", "int4", "int8", "float4", "float8", "numeric":
		return "number"
	case "bool":
		return "bool"
	case "json", "jsonb":
		return "json"
	case "date", "timestamp", "timestamptz", "time":
		return "datetime"
	case "bytea":
		return "binary"
	default:
		return "other"
	}
}
