package service

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type fakeJobHandle struct {
	id         domain.JobID
	sessionID  domain.SessionID
	backendPID int
}

func (h fakeJobHandle) ID() domain.JobID {
	return h.id
}

func (h fakeJobHandle) SessionID() domain.SessionID {
	return h.sessionID
}

func (h fakeJobHandle) BackendPID() int {
	return h.backendPID
}

type fakeQueryRunner struct {
	runQueryFn        func(context.Context, domain.RunQueryRequest) (driver.JobHandle, error)
	getJobFn          func(context.Context, domain.JobID) (domain.JobSummary, error)
	getResultSchemaFn func(context.Context, domain.GetResultSchemaRequest) (domain.ResultSchema, error)
	getRowsFn         func(context.Context, domain.GetRowsRequest) (domain.GetRowsResponse, error)
	cancelJobFn       func(context.Context, domain.JobID) error
	disposeJobFn      func(context.Context, domain.JobID) error
}

func (r *fakeQueryRunner) RunQuery(ctx context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
	if r.runQueryFn != nil {
		return r.runQueryFn(ctx, req)
	}
	return nil, nil
}

func (r *fakeQueryRunner) CancelJob(ctx context.Context, jobID domain.JobID) error {
	if r.cancelJobFn != nil {
		return r.cancelJobFn(ctx, jobID)
	}
	return nil
}

func (r *fakeQueryRunner) GetJob(ctx context.Context, jobID domain.JobID) (domain.JobSummary, error) {
	if r.getJobFn != nil {
		return r.getJobFn(ctx, jobID)
	}
	return domain.JobSummary{}, nil
}

func (r *fakeQueryRunner) GetResultSchema(ctx context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
	if r.getResultSchemaFn != nil {
		return r.getResultSchemaFn(ctx, req)
	}
	return domain.ResultSchema{}, nil
}

func (r *fakeQueryRunner) GetRows(ctx context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
	if r.getRowsFn != nil {
		return r.getRowsFn(ctx, req)
	}
	return domain.GetRowsResponse{}, nil
}

func (r *fakeQueryRunner) DisposeJob(ctx context.Context, jobID domain.JobID) error {
	if r.disposeJobFn != nil {
		return r.disposeJobFn(ctx, jobID)
	}
	return nil
}

type fakeSessionManager struct{}

func (m *fakeSessionManager) AcquireDedicatedSession(context.Context, string) (driver.SessionHandle, error) {
	return nil, nil
}

func (m *fakeSessionManager) ReleaseDedicatedSession(context.Context, domain.SessionID) error {
	return nil
}

type fakeDriverConn struct {
	runner        driver.QueryRunner
	explorer      driver.Explorer
	closeCalls    int
	closeErr      error
	sessionManger driver.SessionManager
}

func (c *fakeDriverConn) Kind() domain.ConnectionKind {
	return domain.ConnectionKindPostgres
}

func (c *fakeDriverConn) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (c *fakeDriverConn) Close() error {
	c.closeCalls++
	return c.closeErr
}

func (c *fakeDriverConn) SessionManager() driver.SessionManager {
	return c.sessionManger
}

func (c *fakeDriverConn) QueryRunner() driver.QueryRunner {
	return c.runner
}

func (c *fakeDriverConn) Explorer() driver.Explorer {
	return c.explorer
}

type fakeDriverFactory struct {
	kind   domain.ConnectionKind
	openFn func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error)
}

func (f *fakeDriverFactory) Kind() domain.ConnectionKind {
	return f.kind
}

func (f *fakeDriverFactory) DisplayName() string {
	return string(f.kind)
}

func (f *fakeDriverFactory) Capabilities() driver.Capabilities {
	return driver.Capabilities{}
}

func (f *fakeDriverFactory) Open(ctx context.Context, profile domain.ConnProfile, secret domain.SecretRef) (driver.DriverConn, error) {
	if f.openFn != nil {
		return f.openFn(ctx, profile, secret)
	}
	return nil, nil
}

func (f *fakeDriverFactory) TestConnection(context.Context, domain.ConnProfile, domain.SecretRef) (domain.ConnectionTestResult, error) {
	return domain.ConnectionTestResult{}, nil
}

func TestQueryServiceGetOrOpenConnErrors(t *testing.T) {
	service := NewQueryService(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{})

	if _, _, err := service.getOrOpenConn(context.Background(), "missing"); err == nil {
		t.Fatal("expected missing profile to fail")
	}

	profiles := map[domain.ConnProfileID]domain.ConnProfile{
		"profile_1": {ID: "profile_1", Kind: domain.ConnectionKindPostgres},
	}
	service = NewQueryService(driver.NewRegistry(), profiles)
	if _, _, err := service.getOrOpenConn(context.Background(), "profile_1"); err == nil {
		t.Fatal("expected missing driver registration to fail")
	}

	registry := driver.NewRegistry()
	openErr := errors.New("open failed")
	if err := registry.Register(&fakeDriverFactory{
		kind: domain.ConnectionKindPostgres,
		openFn: func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
			return nil, openErr
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	service = NewQueryService(registry, profiles)
	if _, _, err := service.getOrOpenConn(context.Background(), "profile_1"); !errors.Is(err, openErr) {
		t.Fatalf("expected open error %v, got %v", openErr, err)
	}
}

func TestQueryServiceGetOrOpenConnCachesConnections(t *testing.T) {
	registry := driver.NewRegistry()
	runner := &fakeQueryRunner{}
	conn := &fakeDriverConn{runner: runner, sessionManger: &fakeSessionManager{}}
	openCalls := 0
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres}

	if err := registry.Register(&fakeDriverFactory{
		kind: profile.Kind,
		openFn: func(_ context.Context, gotProfile domain.ConnProfile, secret domain.SecretRef) (driver.DriverConn, error) {
			openCalls++
			if gotProfile.ID != profile.ID {
				t.Fatalf("expected profile %q, got %q", profile.ID, gotProfile.ID)
			}
			if secret != (domain.SecretRef{}) {
				t.Fatalf("expected empty secret ref, got %+v", secret)
			}
			return conn, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	service := NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{profile.ID: profile})

	firstConn, firstProfile, err := service.getOrOpenConn(context.Background(), profile.ID)
	if err != nil {
		t.Fatalf("first getOrOpenConn failed: %v", err)
	}
	secondConn, secondProfile, err := service.getOrOpenConn(context.Background(), profile.ID)
	if err != nil {
		t.Fatalf("second getOrOpenConn failed: %v", err)
	}

	if openCalls != 1 {
		t.Fatalf("expected connection to be opened once, got %d", openCalls)
	}
	if firstConn != conn || secondConn != conn {
		t.Fatal("expected cached connection to be reused")
	}
	if !reflect.DeepEqual(firstProfile, profile) || !reflect.DeepEqual(secondProfile, profile) {
		t.Fatalf("expected profile lookup to return the cached profile, got %+v and %+v", firstProfile, secondProfile)
	}
}

func TestQueryServiceGetOrOpenConnClosesDuplicateOpenedConnection(t *testing.T) {
	registry := driver.NewRegistry()
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres}
	existingConn := &fakeDriverConn{runner: &fakeQueryRunner{}, sessionManger: &fakeSessionManager{}}
	openedConn := &fakeDriverConn{runner: &fakeQueryRunner{}, sessionManger: &fakeSessionManager{}}

	service := NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{profile.ID: profile})
	if err := registry.Register(&fakeDriverFactory{
		kind: profile.Kind,
		openFn: func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
			service.mu.Lock()
			service.conns[profile.ID] = existingConn
			service.mu.Unlock()
			return openedConn, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	gotConn, _, err := service.getOrOpenConn(context.Background(), profile.ID)
	if err != nil {
		t.Fatalf("getOrOpenConn returned error: %v", err)
	}

	if gotConn != existingConn {
		t.Fatal("expected existing connection to win duplicate open race")
	}
	if openedConn.closeCalls != 1 {
		t.Fatalf("expected duplicate connection to be closed once, got %d", openedConn.closeCalls)
	}
}

func TestQueryServiceCancelJobFallsBackToUniqueOpenConnection(t *testing.T) {
	registry := driver.NewRegistry()
	wrongProfile := domain.ConnProfile{ID: "wrong_profile", Kind: domain.ConnectionKindPostgres}
	rightProfile := domain.ConnProfile{ID: "right_profile", Kind: domain.ConnectionKindPostgres}
	notFoundErr := errors.New(`job "job_2" not found`)
	rightCanceled := false

	wrongConn := &fakeDriverConn{
		runner: &fakeQueryRunner{
			cancelJobFn: func(context.Context, domain.JobID) error {
				return notFoundErr
			},
			getJobFn: func(context.Context, domain.JobID) (domain.JobSummary, error) {
				return domain.JobSummary{}, notFoundErr
			},
		},
		sessionManger: &fakeSessionManager{},
	}
	rightConn := &fakeDriverConn{
		runner: &fakeQueryRunner{
			getJobFn: func(_ context.Context, jobID domain.JobID) (domain.JobSummary, error) {
				if jobID != "job_2" {
					t.Fatalf("unexpected job ID: %q", jobID)
				}
				return domain.JobSummary{JobID: jobID, Status: domain.JobRunning}, nil
			},
			cancelJobFn: func(_ context.Context, jobID domain.JobID) error {
				rightCanceled = jobID == "job_2"
				return nil
			},
		},
		sessionManger: &fakeSessionManager{},
	}

	service := NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{
		wrongProfile.ID: wrongProfile,
		rightProfile.ID: rightProfile,
	})
	service.conns[wrongProfile.ID] = wrongConn
	service.conns[rightProfile.ID] = rightConn

	if err := service.CancelJob(context.Background(), wrongProfile.ID, "job_2"); err != nil {
		t.Fatalf("CancelJob returned error: %v", err)
	}
	if !rightCanceled {
		t.Fatal("expected cancel to be sent to the unique open connection that owns the live job")
	}
}

func TestQueryServiceDelegatesRunnerMethods(t *testing.T) {
	registry := driver.NewRegistry()
	profile := domain.ConnProfile{ID: "profile_1", Kind: domain.ConnectionKindPostgres}
	runReq := domain.RunQueryRequest{ProfileID: profile.ID, SQL: "select 1"}
	expectedSummary := domain.JobSummary{JobID: "job_1", Status: domain.JobSucceeded}
	expectedSchema := domain.ResultSchema{Columns: []domain.ColumnDef{{Name: "one"}}}
	expectedRows := domain.GetRowsResponse{Rows: [][]any{{1}}, RowCountKnown: true, RowCount: 1}
	cancelErr := errors.New("cancel failed")
	disposeErr := errors.New("dispose failed")
	runErr := errors.New("run failed")
	runner := &fakeQueryRunner{
		runQueryFn: func(_ context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
			if !reflect.DeepEqual(req, runReq) {
				t.Fatalf("unexpected run query request: %+v", req)
			}
			return nil, runErr
		},
		getJobFn: func(_ context.Context, jobID domain.JobID) (domain.JobSummary, error) {
			if jobID != "job_1" {
				t.Fatalf("unexpected job ID: %q", jobID)
			}
			return expectedSummary, nil
		},
		getResultSchemaFn: func(_ context.Context, req domain.GetResultSchemaRequest) (domain.ResultSchema, error) {
			if req.JobID != "job_1" {
				t.Fatalf("unexpected schema request: %+v", req)
			}
			return expectedSchema, nil
		},
		getRowsFn: func(_ context.Context, req domain.GetRowsRequest) (domain.GetRowsResponse, error) {
			if req.JobID != "job_1" || req.Count != 5 {
				t.Fatalf("unexpected rows request: %+v", req)
			}
			return expectedRows, nil
		},
		cancelJobFn: func(_ context.Context, jobID domain.JobID) error {
			if jobID != "job_1" {
				t.Fatalf("unexpected cancel job ID: %q", jobID)
			}
			return cancelErr
		},
		disposeJobFn: func(_ context.Context, jobID domain.JobID) error {
			if jobID != "job_1" {
				t.Fatalf("unexpected dispose job ID: %q", jobID)
			}
			return disposeErr
		},
	}
	conn := &fakeDriverConn{runner: runner, sessionManger: &fakeSessionManager{}}
	if err := registry.Register(&fakeDriverFactory{
		kind: profile.Kind,
		openFn: func(context.Context, domain.ConnProfile, domain.SecretRef) (driver.DriverConn, error) {
			return conn, nil
		},
	}); err != nil {
		t.Fatalf("register factory: %v", err)
	}

	service := NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{profile.ID: profile})

	if _, err := service.RunQuery(context.Background(), runReq); !errors.Is(err, runErr) {
		t.Fatalf("expected RunQuery to wrap %v, got %v", runErr, err)
	}

	runner.runQueryFn = func(_ context.Context, req domain.RunQueryRequest) (driver.JobHandle, error) {
		if !reflect.DeepEqual(req, runReq) {
			t.Fatalf("unexpected run query request: %+v", req)
		}
		return fakeJobHandle{id: "job_1", sessionID: "sess_1", backendPID: 42}, nil
	}

	resp, err := service.RunQuery(context.Background(), runReq)
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}
	if resp.JobID != "job_1" || resp.SessionID != "sess_1" || resp.BackendPID != 42 {
		t.Fatalf("unexpected run query response: %+v", resp)
	}

	job, err := service.GetJob(context.Background(), profile.ID, "job_1")
	if err != nil {
		t.Fatalf("GetJob returned error: %v", err)
	}
	if !reflect.DeepEqual(job, expectedSummary) {
		t.Fatalf("unexpected job summary: %+v", job)
	}

	schema, err := service.GetResultSchema(context.Background(), profile.ID, domain.GetResultSchemaRequest{JobID: "job_1"})
	if err != nil {
		t.Fatalf("GetResultSchema returned error: %v", err)
	}
	if len(schema.Columns) != 1 || schema.Columns[0].Name != "one" {
		t.Fatalf("unexpected schema: %+v", schema)
	}

	rows, err := service.GetRows(context.Background(), profile.ID, domain.GetRowsRequest{JobID: "job_1", Count: 5})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}
	if rows.RowCount != 1 || len(rows.Rows) != 1 {
		t.Fatalf("unexpected rows response: %+v", rows)
	}

	if err := service.CancelJob(context.Background(), profile.ID, "job_1"); !errors.Is(err, cancelErr) {
		t.Fatalf("expected CancelJob error %v, got %v", cancelErr, err)
	}
	if err := service.DisposeJob(context.Background(), profile.ID, "job_1"); !errors.Is(err, disposeErr) {
		t.Fatalf("expected DisposeJob error %v, got %v", disposeErr, err)
	}
}

func TestQueryServiceFailsWhenCachedConnectionHasNoMatchingProfile(t *testing.T) {
	service := NewQueryService(driver.NewRegistry(), map[domain.ConnProfileID]domain.ConnProfile{})
	service.conns["profile_1"] = &fakeDriverConn{runner: &fakeQueryRunner{}}

	if _, _, err := service.getOrOpenConn(context.Background(), "profile_1"); err == nil {
		t.Fatal("expected cached connection without profile to fail")
	}
}
