package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"dbx/internal/domain"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestNewQueryRunnerInitializesRegistryAndEmitter(t *testing.T) {
	qr := NewQueryRunner(domain.ConnProfile{ID: "profile_1"}, nil)

	if qr.registry == nil {
		t.Fatal("expected job registry to be initialized")
	}
	if qr.emitter == nil {
		t.Fatal("expected job emitter to be initialized")
	}
}

func TestJobRegistryPutGetDelete(t *testing.T) {
	registry := NewJobRegistry()
	job := &Job{id: "job_1"}

	registry.Put(job)

	got, ok := registry.Get(job.id)
	if !ok || got != job {
		t.Fatal("expected stored job to be returned")
	}

	deleted, ok := registry.Delete(job.id)
	if !ok || deleted != job {
		t.Fatal("expected deleted job to be returned")
	}

	if _, ok := registry.Get(job.id); ok {
		t.Fatal("expected deleted job to be removed")
	}
}

func TestMarkJobRunningTransitionsQueuedJobs(t *testing.T) {
	qr := &QueryRunner{}
	job := &Job{id: "job_1", status: domain.JobQueued}

	snapshot := qr.markJobRunning(job)

	if snapshot.Status != domain.JobRunning {
		t.Fatalf("expected job to become running, got %q", snapshot.Status)
	}
	if snapshot.StartedAt == 0 {
		t.Fatal("expected started timestamp to be set")
	}

	alreadyRunning := &Job{id: "job_2", status: domain.JobRunning, startedAt: 123}
	snapshot = qr.markJobRunning(alreadyRunning)
	if snapshot.StartedAt != 123 {
		t.Fatalf("expected existing started time to remain unchanged, got %d", snapshot.StartedAt)
	}
}

func TestClassifyExecutionError(t *testing.T) {
	qr := &QueryRunner{}
	job := &Job{cancelRequested: true}

	status, jobErr := qr.classifyExecutionError(job, &pgconn.PgError{Code: pgCodeQueryCanceled, Message: "canceling statement due to user request"})
	if status != domain.JobCanceled {
		t.Fatalf("expected canceled status, got %q", status)
	}
	if jobErr == nil || jobErr.Code != "query_canceled" {
		t.Fatalf("unexpected cancellation error payload: %+v", jobErr)
	}

	job.cancelRequested = false
	status, jobErr = qr.classifyExecutionError(job, errors.New("syntax error"))
	if status != domain.JobFailed {
		t.Fatalf("expected failed status, got %q", status)
	}
	if jobErr == nil || jobErr.Code != "query_error" {
		t.Fatalf("unexpected query error payload: %+v", jobErr)
	}
}

func TestFinishWithErrorSetsTerminalState(t *testing.T) {
	qr := &QueryRunner{}
	job := &Job{id: "job_1", status: domain.JobQueued}

	snapshot := qr.finishWithError(job, domain.JobFailed, &domain.JobError{Code: "query_error", Message: "boom"})
	if snapshot.Status != domain.JobFailed {
		t.Fatalf("expected failed status, got %q", snapshot.Status)
	}
	if snapshot.StartedAt == 0 || snapshot.EndedAt == 0 {
		t.Fatalf("expected timestamps to be set, got started=%d ended=%d", snapshot.StartedAt, snapshot.EndedAt)
	}
	if snapshot.Error == nil || snapshot.Error.Message != "boom" {
		t.Fatalf("unexpected error snapshot: %+v", snapshot.Error)
	}

	job.jobErr.Message = "mutated"
	if snapshot.Error.Message != "boom" {
		t.Fatal("expected finishWithError to snapshot the error payload")
	}
}

func TestDisposeJobRejectsNonTerminalJob(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}
	job := &Job{
		id:     domain.JobID("job_1"),
		status: domain.JobRunning,
		done:   make(chan struct{}),
	}
	qr.registry.Put(job)

	err := qr.DisposeJob(context.Background(), job.id)
	if err == nil {
		t.Fatal("expected DisposeJob to reject a running job")
	}

	if _, ok := qr.registry.Get(job.id); !ok {
		t.Fatal("running job should remain in registry after rejected dispose")
	}
}

func TestDisposeJobRemovesTerminalJobWithoutSessionRelease(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}
	job := &Job{
		id:     domain.JobID("job_2"),
		status: domain.JobSucceeded,
		done:   make(chan struct{}),
	}
	qr.registry.Put(job)

	if err := qr.DisposeJob(context.Background(), job.id); err != nil {
		t.Fatalf("DisposeJob returned error: %v", err)
	}

	if _, ok := qr.registry.Get(job.id); ok {
		t.Fatal("terminal job should be removed from registry after dispose")
	}
}

func TestGetJobAndSchemaErrorsAndCopies(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}

	if _, err := qr.GetJob(context.Background(), "missing"); err == nil {
		t.Fatal("expected missing job to fail")
	}
	if _, err := qr.GetResultSchema(context.Background(), domain.GetResultSchemaRequest{JobID: "missing"}); err == nil {
		t.Fatal("expected missing schema job to fail")
	}

	job := &Job{
		id:     "job_1",
		status: domain.JobSucceeded,
		schema: domain.ResultSchema{Columns: []domain.ColumnDef{{Name: "one"}}},
		done:   make(chan struct{}),
	}
	qr.registry.Put(job)

	schema, err := qr.GetResultSchema(context.Background(), domain.GetResultSchemaRequest{JobID: "job_1"})
	if err != nil {
		t.Fatalf("GetResultSchema returned error: %v", err)
	}
	schema.Columns[0].Name = "mutated"

	job.mu.RLock()
	originalName := job.schema.Columns[0].Name
	job.mu.RUnlock()
	if originalName != "one" {
		t.Fatalf("expected stored schema to remain unchanged, got %q", originalName)
	}
}

func TestGetRowsReportsUnknownCountWhileJobRunning(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}
	job := &Job{
		id:     domain.JobID("job_3"),
		status: domain.JobRunning,
		rows: [][]any{
			{1, "a"},
		},
		done: make(chan struct{}),
	}
	qr.registry.Put(job)

	resp, err := qr.GetRows(context.Background(), domain.GetRowsRequest{
		JobID: job.id,
		Start: 0,
		Count: 10,
	})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}

	if resp.RowCountKnown {
		t.Fatal("RowCountKnown should be false while the job is still running")
	}
	if resp.RowCount != 0 {
		t.Fatalf("expected RowCount to remain zero while unknown, got %d", resp.RowCount)
	}
	if len(resp.Rows) != 1 {
		t.Fatalf("expected rows payload to remain unchanged, got %d rows", len(resp.Rows))
	}
}

func TestGetRowsAppliesPagingAndCopiesRowsForTerminalJobs(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}
	job := &Job{
		id:     "job_4",
		status: domain.JobSucceeded,
		rows: [][]any{
			{1, "a"},
			{2, "b"},
			{3, "c"},
		},
		done: make(chan struct{}),
	}
	qr.registry.Put(job)

	resp, err := qr.GetRows(context.Background(), domain.GetRowsRequest{
		JobID: "job_4",
		Start: -10,
		Count: 2,
	})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}

	if !resp.RowCountKnown || resp.RowCount != 3 {
		t.Fatalf("unexpected row count metadata: %+v", resp)
	}
	if resp.Start != 0 || len(resp.Rows) != 2 {
		t.Fatalf("unexpected paging result: %+v", resp)
	}

	resp.Rows[0][0] = 99
	job.mu.RLock()
	original := job.rows[0][0]
	job.mu.RUnlock()
	if original != 1 {
		t.Fatalf("expected stored rows to remain unchanged, got %v", original)
	}
}

func TestGetRowsRejectsMissingJob(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}

	if _, err := qr.GetRows(context.Background(), domain.GetRowsRequest{JobID: "missing"}); err == nil {
		t.Fatal("expected missing job to fail")
	}
}

func TestCancelJobBehaviors(t *testing.T) {
	qr := &QueryRunner{registry: NewJobRegistry()}

	if err := qr.CancelJob(context.Background(), "missing"); err == nil {
		t.Fatal("expected missing job to fail")
	}

	terminalJob := &Job{id: "job_terminal", status: domain.JobSucceeded, backendPID: 42, done: make(chan struct{})}
	qr.registry.Put(terminalJob)
	if err := qr.CancelJob(context.Background(), terminalJob.id); err != nil {
		t.Fatalf("expected canceling terminal job to be a no-op, got %v", err)
	}

	noPIDJob := &Job{id: "job_no_pid", status: domain.JobRunning, done: make(chan struct{})}
	qr.registry.Put(noPIDJob)
	if err := qr.CancelJob(context.Background(), noPIDJob.id); err == nil {
		t.Fatal("expected missing backend pid to fail")
	}

	alreadyRequested := &Job{id: "job_requested", status: domain.JobRunning, backendPID: 42, cancelRequested: true, done: make(chan struct{})}
	qr.registry.Put(alreadyRequested)
	if err := qr.CancelJob(context.Background(), alreadyRequested.id); err != nil {
		t.Fatalf("expected duplicate cancel request to be a no-op, got %v", err)
	}

	runnable := &Job{id: "job_running", status: domain.JobRunning, backendPID: 42, database: "", done: make(chan struct{})}
	qr.registry.Put(runnable)
	if err := qr.CancelJob(context.Background(), runnable.id); err != nil {
		t.Fatalf("CancelJob returned error: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		runnable.mu.RLock()
		cancelRequested := runnable.cancelRequested
		cancelStarted := runnable.cancelStarted
		runnable.mu.RUnlock()

		if cancelRequested && !cancelStarted {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("expected async cancel attempt to reset cancelStarted")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestSendCancelResetsCancelStartedOnEarlyFailure(t *testing.T) {
	qr := &QueryRunner{
		profile:  domain.ConnProfile{},
		registry: NewJobRegistry(),
	}
	job := &Job{
		id:            domain.JobID("job_4"),
		status:        domain.JobRunning,
		cancelStarted: true,
		done:          make(chan struct{}),
	}
	qr.registry.Put(job)

	qr.sendCancel(context.Background(), job.id, "", 1234)

	job.mu.RLock()
	cancelStarted := job.cancelStarted
	job.mu.RUnlock()

	if cancelStarted {
		t.Fatal("cancelStarted should be reset when sendCancel exits early")
	}
}

func TestCloseJobDoneIsIdempotent(t *testing.T) {
	job := &Job{done: make(chan struct{})}

	closeJobDone(job)
	closeJobDone(job)

	select {
	case <-job.done:
	default:
		t.Fatal("expected job done channel to be closed")
	}
}

func TestReleaseJobSessionOnlyRunsOnce(t *testing.T) {
	qr := &QueryRunner{
		sessionManager: &SessionManager{sessions: make(map[domain.SessionID]*sessionHandle)},
	}
	job := &Job{
		id:        domain.JobID("job_5"),
		sessionID: domain.SessionID("sess_missing"),
		done:      make(chan struct{}),
	}

	qr.releaseJobSession(context.Background(), job)
	qr.releaseJobSession(context.Background(), job)

	job.mu.RLock()
	sessionReleased := job.sessionReleased
	job.mu.RUnlock()

	if !sessionReleased {
		t.Fatal("session should be marked released after cleanup")
	}
}

func TestJobSnapshotAndHelpers(t *testing.T) {
	job := &Job{
		id:        "job_1",
		profileID: "profile_1",
		database:  "postgres",
		status:    domain.JobSucceeded,
		rows:      [][]any{{1}, {2}},
		schema:    domain.ResultSchema{Columns: []domain.ColumnDef{{Name: "one"}}},
		jobErr:    &domain.JobError{Code: "query_error", Message: "boom"},
	}

	snapshot := job.snapshot()
	if snapshot.JobID != "job_1" || snapshot.ProfileID != "profile_1" || snapshot.Database != "postgres" {
		t.Fatalf("unexpected snapshot identity: %+v", snapshot)
	}
	if len(snapshot.ResultSets) != 1 || snapshot.ResultSets[0].CommandTag != "SELECT" || snapshot.ResultSets[0].RowCount != 2 {
		t.Fatalf("unexpected result set snapshot: %+v", snapshot.ResultSets)
	}

	job.jobErr.Message = "changed"
	if snapshot.Error == nil || snapshot.Error.Message != "boom" {
		t.Fatalf("expected error snapshot to be copied, got %+v", snapshot.Error)
	}

	if !isTerminal(domain.JobSucceeded) || !isTerminal(domain.JobFailed) || !isTerminal(domain.JobCanceled) {
		t.Fatal("expected terminal statuses to be recognized")
	}
	if isTerminal(domain.JobRunning) {
		t.Fatal("did not expect running job to be terminal")
	}

	if !isQueryCanceledError(errors.New("canceling statement due to user request")) {
		t.Fatal("expected cancellation string to be recognized")
	}
	if isQueryCanceledError(errors.New("other error")) {
		t.Fatal("did not expect unrelated error to be recognized as cancellation")
	}

	if categoryForType("VARCHAR") != "text" || categoryForType("int8") != "number" || categoryForType("bool") != "bool" || categoryForType("jsonb") != "json" || categoryForType("timestamp") != "datetime" || categoryForType("bytea") != "binary" || categoryForType("geography") != "other" {
		t.Fatal("unexpected category mapping")
	}

	handle := &jobHandle{id: "job_2", sessionID: "sess_2", backendPID: 99}
	if handle.ID() != "job_2" || handle.SessionID() != "sess_2" || handle.BackendPID() != 99 {
		t.Fatalf("unexpected job handle values: id=%q session=%q pid=%d", handle.ID(), handle.SessionID(), handle.BackendPID())
	}
}
