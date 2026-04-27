package postgres

import (
	"context"
	"errors"
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

const (
	resultSetIDDefault  = domain.ResultSetID("rs_1")
	pgCodeQueryCanceled = "57014"
)

type QueryRunner struct {
	profile        domain.ConnProfile
	sessionManager *SessionManager
	jobCounter     uint64
	registry       *JobRegistry
	emitter        JobEventEmitter
}

type QueryRunnerOption func(*QueryRunner)

type JobEventEmitter interface {
	EmitQueued(ctx context.Context, summary domain.JobSummary)
	EmitStarted(ctx context.Context, summary domain.JobSummary)
	EmitResultSet(ctx context.Context, summary domain.JobSummary, schema domain.ResultSchema)
	EmitCompleted(ctx context.Context, summary domain.JobSummary)
	EmitFailed(ctx context.Context, summary domain.JobSummary)
	EmitCanceled(ctx context.Context, summary domain.JobSummary)
}

type noopJobEventEmitter struct{}

func (noopJobEventEmitter) EmitQueued(context.Context, domain.JobSummary)                         {}
func (noopJobEventEmitter) EmitStarted(context.Context, domain.JobSummary)                        {}
func (noopJobEventEmitter) EmitResultSet(context.Context, domain.JobSummary, domain.ResultSchema) {}
func (noopJobEventEmitter) EmitCompleted(context.Context, domain.JobSummary)                      {}
func (noopJobEventEmitter) EmitFailed(context.Context, domain.JobSummary)                         {}
func (noopJobEventEmitter) EmitCanceled(context.Context, domain.JobSummary)                       {}

type JobRegistry struct {
	mu   sync.RWMutex
	jobs map[domain.JobID]*Job
}

type Job struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
	profileID  domain.ConnProfileID
	database   string
	request    domain.RunQueryRequest

	mu sync.RWMutex

	status          domain.JobStatus
	createdAt       int64
	startedAt       int64
	endedAt         int64
	jobErr          *domain.JobError
	cancelRequested bool
	cancelStarted   bool
	sessionReleased bool
	disposed        bool

	schema     domain.ResultSchema
	rows       [][]any
	resultSets []domain.ResultSetSummary

	done chan struct{}
}

type jobHandle struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
}

func NewQueryRunner(profile domain.ConnProfile, sm *SessionManager, opts ...QueryRunnerOption) *QueryRunner {
	qr := &QueryRunner{
		profile:        profile,
		sessionManager: sm,
		registry:       NewJobRegistry(),
		emitter:        noopJobEventEmitter{},
	}
	for _, opt := range opts {
		opt(qr)
	}
	if qr.emitter == nil {
		qr.emitter = noopJobEventEmitter{}
	}
	return qr
}

func WithJobEventEmitter(emitter JobEventEmitter) QueryRunnerOption {
	return func(qr *QueryRunner) {
		if emitter != nil {
			qr.emitter = emitter
		}
	}
}

func NewJobRegistry() *JobRegistry {
	return &JobRegistry{jobs: make(map[domain.JobID]*Job)}
}

func (r *JobRegistry) Put(job *Job) {
	r.mu.Lock()
	r.jobs[job.id] = job
	r.mu.Unlock()
}

func (r *JobRegistry) Get(jobID domain.JobID) (*Job, bool) {
	r.mu.RLock()
	job, ok := r.jobs[jobID]
	r.mu.RUnlock()
	return job, ok
}

func (r *JobRegistry) Delete(jobID domain.JobID) (*Job, bool) {
	r.mu.Lock()
	job, ok := r.jobs[jobID]
	if ok {
		delete(r.jobs, jobID)
	}
	r.mu.Unlock()
	return job, ok
}

func (qr *QueryRunner) RunQuery(ctx context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
	session, err := qr.sessionManager.AcquireDedicatedSession(ctx, req.Database)
	if err != nil {
		return nil, fmt.Errorf("acquire dedicated session: %w", err)
	}

	h, ok := session.(*sessionHandle)
	if !ok {
		_ = session.Close()
		return nil, fmt.Errorf("internal session type assertion failed")
	}

	next := atomic.AddUint64(&qr.jobCounter, 1)
	jobID := domain.JobID(fmt.Sprintf("job_%d", next))

	now := time.Now().UnixMilli()
	job := &Job{
		id:         jobID,
		sessionID:  h.info.ID,
		backendPID: h.info.BackendPID,
		profileID:  req.ProfileID,
		database:   h.info.Database,
		request:    req,
		status:     domain.JobQueued,
		createdAt:  now,
		schema:     domain.ResultSchema{Columns: []domain.ColumnDef{}},
		rows:       make([][]any, 0),
		resultSets: make([]domain.ResultSetSummary, 0),
		done:       make(chan struct{}),
	}

	qr.registry.Put(job)
	queued := job.snapshot()
	qr.emitter.EmitQueued(ctx, queued)

	go qr.runJob(context.Background(), job, h)

	return &jobHandle{id: jobID, sessionID: h.info.ID, backendPID: h.info.BackendPID}, nil
}

func (qr *QueryRunner) runJob(ctx context.Context, job *Job, session *sessionHandle) {
	defer func() {
		qr.releaseJobSession(context.Background(), job)
		closeJobDone(job)
	}()

	startedSnapshot := qr.markJobRunning(job)
	qr.emitter.EmitStarted(ctx, startedSnapshot)

	schema, rows, resultSummary, runErr := qr.executeSingleResultQuery(ctx, session, job.request.SQL)
	if runErr == nil {
		job.mu.Lock()
		if !isTerminal(job.status) {
			job.schema = schema
			job.rows = rows
			job.resultSets = []domain.ResultSetSummary{resultSummary}
			job.status = domain.JobSucceeded
			job.startedAt = startedSnapshot.StartedAt
			job.endedAt = time.Now().UnixMilli()
			job.jobErr = nil
			jobSummary := job.snapshotLocked()
			job.mu.Unlock()

			qr.emitter.EmitResultSet(ctx, jobSummary, schema)
			qr.emitter.EmitCompleted(ctx, jobSummary)
			return
		}
		job.mu.Unlock()
		return
	}

	status, jobErr := qr.classifyExecutionError(job, runErr)
	terminal := qr.finishWithError(job, status, jobErr)

	switch terminal.Status {
	case domain.JobCanceled:
		qr.emitter.EmitCanceled(ctx, terminal)
	default:
		qr.emitter.EmitFailed(ctx, terminal)
	}
}

func (qr *QueryRunner) executeSingleResultQuery(ctx context.Context, session *sessionHandle, sql string) (domain.ResultSchema, [][]any, domain.ResultSetSummary, error) {
	rows, err := session.conn.Query(ctx, sql)
	if err != nil {
		return domain.ResultSchema{}, nil, domain.ResultSetSummary{}, err
	}
	defer rows.Close()

	fieldDescriptions := rows.FieldDescriptions()
	schema := buildSchema(fieldDescriptions, session.conn)
	storedRows := make([][]any, 0)

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return domain.ResultSchema{}, nil, domain.ResultSetSummary{}, fmt.Errorf("row decode: %w", err)
		}
		storedRows = append(storedRows, cloneRow(vals))
	}

	if err := rows.Err(); err != nil {
		return domain.ResultSchema{}, nil, domain.ResultSetSummary{}, err
	}

	commandTag := rows.CommandTag()
	summary := domain.ResultSetSummary{
		ResultSetID:    resultSetIDDefault,
		StatementIndex: 0,
		CommandTag:     commandTag.String(),
		RowsAffected:   commandTag.RowsAffected(),
		RowCountKnown:  true,
		RowCount:       int64(len(storedRows)),
	}
	if len(fieldDescriptions) == 0 {
		schema = domain.ResultSchema{Columns: []domain.ColumnDef{}}
		summary.RowCount = 0
	}
	return schema, storedRows, summary, nil
}

func (qr *QueryRunner) markJobRunning(job *Job) domain.JobSummary {
	now := time.Now().UnixMilli()
	job.mu.Lock()
	if job.status == domain.JobQueued {
		job.status = domain.JobRunning
		job.startedAt = now
	}
	snapshot := job.snapshotLocked()
	job.mu.Unlock()
	return snapshot
}

func (qr *QueryRunner) classifyExecutionError(job *Job, err error) (domain.JobStatus, *domain.JobError) {
	job.mu.RLock()
	cancelRequested := job.cancelRequested
	job.mu.RUnlock()

	if cancelRequested && isQueryCanceledError(err) {
		return domain.JobCanceled, &domain.JobError{Code: "query_canceled", Message: err.Error()}
	}
	return domain.JobFailed, &domain.JobError{Code: "query_error", Message: err.Error()}
}

func (qr *QueryRunner) finishWithError(job *Job, status domain.JobStatus, jobErr *domain.JobError) domain.JobSummary {
	job.mu.Lock()
	if !isTerminal(job.status) {
		job.status = status
		if job.startedAt == 0 {
			job.startedAt = time.Now().UnixMilli()
		}
		job.endedAt = time.Now().UnixMilli()
		job.jobErr = jobErr
	}
	snapshot := job.snapshotLocked()
	job.mu.Unlock()
	return snapshot
}

func closeJobDone(job *Job) {
	job.mu.Lock()
	defer job.mu.Unlock()
	select {
	case <-job.done:
		return
	default:
		close(job.done)
	}
}

func (qr *QueryRunner) CancelJob(ctx context.Context, jobID domain.JobID) error {
	job, ok := qr.registry.Get(jobID)
	if !ok {
		return fmt.Errorf("job %q not found", jobID)
	}

	job.mu.Lock()
	if isTerminal(job.status) {
		job.mu.Unlock()
		return nil
	}
	if job.backendPID == 0 {
		job.mu.Unlock()
		return fmt.Errorf("job %q cannot be canceled: missing backend PID", jobID)
	}
	if job.cancelRequested {
		job.mu.Unlock()
		return nil
	}
	job.cancelRequested = true
	job.cancelStarted = true
	backendPID := job.backendPID
	database := job.database
	job.mu.Unlock()

	go qr.sendCancel(context.Background(), jobID, database, backendPID)
	_ = ctx
	return nil
}

func (qr *QueryRunner) sendCancel(ctx context.Context, jobID domain.JobID, database string, backendPID int) {
	defer qr.resetCancelStarted(jobID)

	cfg, err := buildConnConfig(qr.profile, database)
	if err != nil {
		return
	}

	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return
	}
	defer conn.Close(ctx)

	var canceled bool
	if err := conn.QueryRow(ctx, "select pg_cancel_backend($1)", backendPID).Scan(&canceled); err != nil {
		return
	}
	if !canceled {
		return
	}
}

func (qr *QueryRunner) GetJob(ctx context.Context, jobID domain.JobID) (domain.JobSummary, error) {
	_ = ctx
	job, ok := qr.registry.Get(jobID)
	if !ok {
		return domain.JobSummary{}, fmt.Errorf("job %q not found", jobID)
	}
	return job.snapshot(), nil
}

func (qr *QueryRunner) GetResultSchema(ctx context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	_ = ctx
	job, ok := qr.registry.Get(req.JobID)
	if !ok {
		return domain.ResultSchema{}, fmt.Errorf("job %q not found", req.JobID)
	}
	if !isDefaultResultSetID(req.ResultSetID) {
		return domain.ResultSchema{}, fmt.Errorf("result set %q not found for job %q", req.ResultSetID, req.JobID)
	}

	job.mu.RLock()
	schema := domain.ResultSchema{Columns: make([]domain.ColumnDef, len(job.schema.Columns))}
	copy(schema.Columns, job.schema.Columns)
	job.mu.RUnlock()

	return schema, nil
}

func (qr *QueryRunner) GetRows(ctx context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	_ = ctx
	job, ok := qr.registry.Get(req.JobID)
	if !ok {
		return domain.GetRowsResponse{}, fmt.Errorf("job %q not found", req.JobID)
	}
	if !isDefaultResultSetID(req.ResultSetID) {
		return domain.GetRowsResponse{}, fmt.Errorf("result set %q not found for job %q", req.ResultSetID, req.JobID)
	}

	job.mu.RLock()
	status := job.status
	total := len(job.rows)
	start := req.Start
	if start < 0 {
		start = 0
	}
	if start > total {
		start = total
	}

	count := req.Count
	if count < 0 {
		count = 0
	}

	end := start + count
	if end > total {
		end = total
	}

	paged := make([][]any, end-start)
	for i := start; i < end; i++ {
		paged[i-start] = cloneRow(job.rows[i])
	}
	job.mu.RUnlock()

	if !isTerminal(status) {
		return domain.GetRowsResponse{Start: start, Rows: paged, RowCountKnown: false}, nil
	}

	return domain.GetRowsResponse{Start: start, Rows: paged, RowCountKnown: true, RowCount: int64(total)}, nil
}

func (qr *QueryRunner) DisposeJob(ctx context.Context, jobID domain.JobID) error {
	_ = ctx

	job, ok := qr.registry.Get(jobID)
	if !ok {
		return nil
	}

	job.mu.Lock()
	if job.disposed {
		job.mu.Unlock()
		return nil
	}
	if !isTerminal(job.status) {
		status := job.status
		job.mu.Unlock()
		return fmt.Errorf("job %q is still %s", jobID, status)
	}
	job.disposed = true
	job.mu.Unlock()

	qr.registry.Delete(jobID)
	return nil
}

func (qr *QueryRunner) releaseJobSession(ctx context.Context, job *Job) {
	job.mu.Lock()
	if job.sessionReleased {
		job.mu.Unlock()
		return
	}
	job.sessionReleased = true
	sessionID := job.sessionID
	job.mu.Unlock()

	if qr.sessionManager == nil {
		return
	}

	_ = qr.sessionManager.ReleaseDedicatedSession(ctx, sessionID)
}

func (qr *QueryRunner) resetCancelStarted(jobID domain.JobID) {
	// State is not forced here; terminal status is resolved by the runner based on
	// the actual execution error so cancellation races don't clobber natural completion.
	job, ok := qr.registry.Get(jobID)
	if !ok {
		return
	}

	job.mu.Lock()
	job.cancelStarted = false
	job.mu.Unlock()
}

func (j *Job) snapshot() domain.JobSummary {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.snapshotLocked()
}

func (j *Job) snapshotLocked() domain.JobSummary {
	resultSets := cloneResultSetSummaries(j.resultSets)

	var copiedErr *domain.JobError
	if j.jobErr != nil {
		errCopy := *j.jobErr
		copiedErr = &errCopy
	}

	return domain.JobSummary{
		JobID:      j.id,
		ProfileID:  j.profileID,
		Database:   j.database,
		Status:     j.status,
		StartedAt:  j.startedAt,
		EndedAt:    j.endedAt,
		Error:      copiedErr,
		ResultSets: resultSets,
	}
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

func isTerminal(status domain.JobStatus) bool {
	return status == domain.JobSucceeded || status == domain.JobFailed || status == domain.JobCanceled
}

func isQueryCanceledError(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == pgCodeQueryCanceled
	}
	return strings.Contains(strings.ToLower(err.Error()), "canceling statement due to user request")
}

func isDefaultResultSetID(resultSetID domain.ResultSetID) bool {
	return resultSetID == "" || resultSetID == resultSetIDDefault
}

func cloneResultSetSummaries(resultSets []domain.ResultSetSummary) []domain.ResultSetSummary {
	if len(resultSets) == 0 {
		return []domain.ResultSetSummary{}
	}
	copied := make([]domain.ResultSetSummary, len(resultSets))
	copy(copied, resultSets)
	return copied
}

func cloneRow(row []any) []any {
	copied := make([]any, len(row))
	for i, value := range row {
		copied[i] = cloneValue(value)
	}
	return copied
}

func cloneValue(value any) any {
	switch v := value.(type) {
	case []byte:
		if v == nil {
			return []byte(nil)
		}
		copied := make([]byte, len(v))
		copy(copied, v)
		return copied
	default:
		return value
	}
}
