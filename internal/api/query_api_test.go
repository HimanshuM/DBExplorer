package api

import (
	"context"
	"reflect"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"dbx/internal/service"
)

type apiJobHandle struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
}

func (h apiJobHandle) ID() domain.JobID {
	return h.id
}

func (h apiJobHandle) SessionID() domain.SessionID {
	return h.sessionID
}

func (h apiJobHandle) BackendPID() int {
	return h.backendPID
}

type apiQueryRunner struct {
	runQueryFn        func(context.Context, domain.RunQueryRequest) (driver.JobHandle, error)
	getJobFn          func(context.Context, domain.JobID) (domain.JobSummary, error)
	getResultSchemaFn func(context.Context, domain.GetResultSchemaRequest) (domain.ResultSchema, error)
	getRowsFn         func(context.Context, domain.GetRowsRequest) (domain.GetRowsResponse, error)
	cancelJobFn       func(context.Context, domain.JobID) error
	disposeJobFn      func(context.Context, domain.JobID) error
}

func (r *apiQueryRunner) RunQuery(ctx context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
	return r.runQueryFn(ctx, req)
}

func (r *apiQueryRunner) CancelJob(ctx context.Context, jobID domain.JobID) error {
	return r.cancelJobFn(ctx, jobID)
}

func (r *apiQueryRunner) GetJob(ctx context.Context, jobID domain.JobID) (domain.JobSummary, error) {
	return r.getJobFn(ctx, jobID)
}

func (r *apiQueryRunner) GetResultSchema(ctx context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	return r.getResultSchemaFn(ctx, req)
}

func (r *apiQueryRunner) GetRows(ctx context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	return r.getRowsFn(ctx, req)
}

func (r *apiQueryRunner) DisposeJob(ctx context.Context, jobID domain.JobID) error {
	return r.disposeJobFn(ctx, jobID)
}

type apiDriverConn struct {
	runner   driver.QueryRunner
	explorer driver.Explorer
}

func (c *apiDriverConn) Kind() domain.ConnectionKind {
	return domain.ConnectionKindPostgres
}

func (c *apiDriverConn) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (c *apiDriverConn) Close() error {
	return nil
}

func (c *apiDriverConn) SessionManager() driver.SessionManager {
	return nil
}

func (c *apiDriverConn) QueryRunner() driver.QueryRunner {
	return c.runner
}

func (c *apiDriverConn) Explorer() driver.Explorer {
	return c.explorer
}

type apiQueryFactory struct {
	kind   domain.ConnectionKind
	openFn func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error)
}

func (f *apiQueryFactory) Kind() domain.ConnectionKind {
	return f.kind
}

func (f *apiQueryFactory) DisplayName() string {
	return string(f.kind)
}

func (f *apiQueryFactory) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (f *apiQueryFactory) Open(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (driver.DriverConn, error) {
	return f.openFn(ctx, profile, secret)
}

func (f *apiQueryFactory) TestConnection(context.Context, domain.ConnProfile, domain.SecretRef) (domain.ConnectionTestResult, error) {
	return domain.ConnectionTestResult{}, nil
}

func TestQueryAPIDelegatesToService(t *testing.T) {
	registry := driver.NewRegistry()
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres}
	runReq := domain.RunQueryRequest{ProfileID: profile.ID, SQL: "select 1"}
	expectedSchema := domain.ResultSchema{Columns: []domain.ColumnDef{{Name: "one"}}}
	expectedRows := domain.GetRowsResponse{Rows: [][]any{{1}}, RowCountKnown: true, RowCount: 1}
	expectedJob := domain.JobSummary{JobID: "job_1", Status: domain.JobSucceeded}
	canceled := false
	disposed := false

	runner := &apiQueryRunner{
		runQueryFn: func(_ context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
			if !reflect.DeepEqual(req, runReq) {
				t.Fatalf("unexpected run query request: %+v", req)
			}
			return apiJobHandle{id: "job_1", sessionID: "sess_1", backendPID: 77}, nil
		},
		getJobFn: func(_ context.Context, jobID domain.JobID) (domain.JobSummary, error) {
			if jobID != "job_1" {
				t.Fatalf("unexpected job ID: %q", jobID)
			}
			return expectedJob, nil
		},
		getResultSchemaFn: func(_ context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
			if req.JobID != "job_1" {
				t.Fatalf("unexpected schema request: %+v", req)
			}
			return expectedSchema, nil
		},
		getRowsFn: func(_ context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
			if req.JobID != "job_1" || req.Count != 10 {
				t.Fatalf("unexpected rows request: %+v", req)
			}
			return expectedRows, nil
		},
		cancelJobFn: func(_ context.Context, jobID domain.JobID) error {
			canceled = jobID == "job_1"
			return nil
		},
		disposeJobFn: func(_ context.Context, jobID domain.JobID) error {
			disposed = jobID == "job_1"
			return nil
		},
	}

	if err := registry.Register(&apiQueryFactory{
		kind: profile.Kind,
		openFn: func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
			return &apiDriverConn{runner: runner}, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	api := NewQueryAPI(service.NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{profile.ID: profile}))

	runResp, err := api.RunQuery(runReq)
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}
	if runResp.JobID != "job_1" || runResp.SessionID != "sess_1" || runResp.BackendPID != 77 {
		t.Fatalf("unexpected run response: %+v", runResp)
	}

	job, err := api.GetJob(profile.ID, "job_1")
	if err != nil {
		t.Fatalf("GetJob returned error: %v", err)
	}
	if !reflect.DeepEqual(job, expectedJob) {
		t.Fatalf("unexpected job: %+v", job)
	}

	schema, err := api.GetResultSchema(profile.ID, domain.GetResultSchemaRequest{JobID: "job_1"})
	if err != nil {
		t.Fatalf("GetResultSchema returned error: %v", err)
	}
	if len(schema.Columns) != 1 || schema.Columns[0].Name != "one" {
		t.Fatalf("unexpected schema: %+v", schema)
	}

	rows, err := api.GetRows(profile.ID, domain.GetRowsRequest{JobID: "job_1", Count: 10})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}
	if rows.RowCount != 1 || len(rows.Rows) != 1 {
		t.Fatalf("unexpected rows: %+v", rows)
	}

	if err := api.CancelJob(profile.ID, "job_1"); err != nil {
		t.Fatalf("CancelJob returned error: %v", err)
	}
	if !canceled {
		t.Fatal("expected CancelJob to delegate to the query runner")
	}

	if err := api.DisposeJob(profile.ID, "job_1"); err != nil {
		t.Fatalf("DisposeJob returned error: %v", err)
	}
	if !disposed {
		t.Fatal("expected DisposeJob to delegate to the query runner")
	}
}
