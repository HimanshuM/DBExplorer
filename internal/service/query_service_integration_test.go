//go:build integration

package service

import (
	"context"
	"testing"
	"time"

	"dbx/internal/domain"
	"dbx/internal/driver"
	"dbx/internal/postgres"
)

func newIntegrationQueryService(t *testing.T, profile domain.ConnProfile) *QueryService {
	t.Helper()

	registry := driver.NewRegistry()
	if err := registry.Register(postgres.NewFactory()); err != nil {
		t.Fatalf("register postgres factory: %v", err)
	}

	return NewQueryService(registry, map[domain.ConnProfileID]domain.ConnProfile{
		profile.ID: profile,
	})
}

func TestQueryServiceRunQueryAndFetchResultsEndToEnd(t *testing.T) {
	env := startTestPostgres(t)
	service := newIntegrationQueryService(t, env.Profile)

	runResp, err := service.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select 1 as one, 'hello' as greeting",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}
	if runResp.JobID == "" || runResp.SessionID == "" || runResp.BackendPID <= 0 {
		t.Fatalf("unexpected run query response: %+v", runResp)
	}

	job := waitForJobTerminal(t, context.Background(), service, env.Profile.ID, runResp.JobID, 10*time.Second)
	if job.Status != domain.JobSucceeded {
		t.Fatalf("expected succeeded job, got %+v", job)
	}

	schema, err := service.GetResultSchema(context.Background(), env.Profile.ID, domain.GetResultSchemaRequest{
		JobID:       runResp.JobID,
		ResultSetID: domain.ResultSetID("rs_1"),
	})
	if err != nil {
		t.Fatalf("GetResultSchema returned error: %v", err)
	}
	if len(schema.Columns) != 2 {
		t.Fatalf("expected 2 columns, got %+v", schema.Columns)
	}
	if schema.Columns[0].Name != "one" || schema.Columns[1].Name != "greeting" {
		t.Fatalf("unexpected schema: %+v", schema.Columns)
	}

	rows, err := service.GetRows(context.Background(), env.Profile.ID, domain.GetRowsRequest{
		JobID:       runResp.JobID,
		ResultSetID: domain.ResultSetID("rs_1"),
		Start:       0,
		Count:       10,
	})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}
	if !rows.RowCountKnown || rows.RowCount != 1 || len(rows.Rows) != 1 {
		t.Fatalf("unexpected rows metadata: %+v", rows)
	}
	if got := requireInt32(t, rows.Rows[0][0]); got != 1 {
		t.Fatalf("expected first value 1, got %d", got)
	}
	if got := requireString(t, rows.Rows[0][1]); got != "hello" {
		t.Fatalf("expected second value %q, got %q", "hello", got)
	}
}

func TestQueryServiceCancelJobEndToEnd(t *testing.T) {
	env := startTestPostgres(t)
	service := newIntegrationQueryService(t, env.Profile)

	runResp, err := service.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select pg_sleep(10)",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}

	waitForJobStatus(t, context.Background(), service, env.Profile.ID, runResp.JobID, domain.JobRunning, 3*time.Second)

	if err := service.CancelJob(context.Background(), env.Profile.ID, runResp.JobID); err != nil {
		t.Fatalf("CancelJob returned error: %v", err)
	}

	job := waitForJobTerminal(t, context.Background(), service, env.Profile.ID, runResp.JobID, 10*time.Second)
	if job.Status != domain.JobCanceled {
		t.Fatalf("expected canceled job, got %+v", job)
	}
	if job.Error == nil || job.Error.Code != "query_canceled" {
		t.Fatalf("expected query_canceled error payload, got %+v", job.Error)
	}
}

func TestQueryServiceDisposeJobEndToEnd(t *testing.T) {
	env := startTestPostgres(t)
	service := newIntegrationQueryService(t, env.Profile)

	runResp, err := service.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select 42 as answer",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}

	job := waitForJobTerminal(t, context.Background(), service, env.Profile.ID, runResp.JobID, 10*time.Second)
	if job.Status != domain.JobSucceeded {
		t.Fatalf("expected succeeded job, got %+v", job)
	}

	if err := service.DisposeJob(context.Background(), env.Profile.ID, runResp.JobID); err != nil {
		t.Fatalf("DisposeJob returned error: %v", err)
	}

	if _, err := service.GetJob(context.Background(), env.Profile.ID, runResp.JobID); err == nil {
		t.Fatal("expected disposed job lookup to fail")
	}
}

func TestQueryServiceReusesConnectionPerProfile(t *testing.T) {
	env := startTestPostgres(t,
		"create table people (id int primary key, name text not null)",
		"insert into people (id, name) values (1, 'Ada'), (2, 'Linus')",
	)
	service := newIntegrationQueryService(t, env.Profile)

	firstResp, err := service.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select id, name from people order by id",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("first RunQuery returned error: %v", err)
	}
	firstJob := waitForJobTerminal(t, context.Background(), service, env.Profile.ID, firstResp.JobID, 10*time.Second)
	if firstJob.Status != domain.JobSucceeded {
		t.Fatalf("expected first job to succeed, got %+v", firstJob)
	}

	if got := len(service.conns); got != 1 {
		t.Fatalf("expected one cached connection after first query, got %d", got)
	}
	firstConn := service.conns[env.Profile.ID]
	if firstConn == nil {
		t.Fatal("expected cached connection to be stored after first query")
	}

	secondResp, err := service.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select count(*) from people",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("second RunQuery returned error: %v", err)
	}
	secondJob := waitForJobTerminal(t, context.Background(), service, env.Profile.ID, secondResp.JobID, 10*time.Second)
	if secondJob.Status != domain.JobSucceeded {
		t.Fatalf("expected second job to succeed, got %+v", secondJob)
	}

	if got := len(service.conns); got != 1 {
		t.Fatalf("expected cached connection count to remain one, got %d", got)
	}
	secondConn := service.conns[env.Profile.ID]
	if secondConn != firstConn {
		t.Fatal("expected QueryService to reuse the same cached connection for the profile")
	}
}
