//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"dbx/internal/domain"
)

func TestQueryRunnerRunQuerySelect(t *testing.T) {
	env := startTestPostgres(t)
	qr := NewQueryRunner(env.Profile, NewSessionManager(env.Profile))

	handle, err := qr.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select 1 as one, 'hello' as greeting, true as active",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}
	if handle.ID() == "" {
		t.Fatal("expected non-empty job ID")
	}
	if handle.SessionID() == "" {
		t.Fatal("expected non-empty session ID")
	}
	if handle.BackendPID() <= 0 {
		t.Fatalf("expected positive backend PID, got %d", handle.BackendPID())
	}

	job := waitForJobTerminal(t, context.Background(), qr, handle.ID(), 10*time.Second)
	if job.Status != domain.JobSucceeded {
		t.Fatalf("expected succeeded job, got %+v", job)
	}
	if len(job.ResultSets) != 1 {
		t.Fatalf("expected one result set, got %+v", job.ResultSets)
	}

	schema, err := qr.GetResultSchema(context.Background(), domain.GetResultSchemaRequest{
		JobID:       handle.ID(),
		ResultSetID: resultSetIDDefault,
	})
	if err != nil {
		t.Fatalf("GetResultSchema returned error: %v", err)
	}
	if len(schema.Columns) != 3 {
		t.Fatalf("expected 3 columns, got %+v", schema.Columns)
	}
	if schema.Columns[0].Name != "one" || schema.Columns[0].Type.Category != "number" {
		t.Fatalf("unexpected first column: %+v", schema.Columns[0])
	}
	if schema.Columns[1].Name != "greeting" || schema.Columns[1].Type.Category != "text" {
		t.Fatalf("unexpected second column: %+v", schema.Columns[1])
	}
	if schema.Columns[2].Name != "active" || schema.Columns[2].Type.Category != "bool" {
		t.Fatalf("unexpected third column: %+v", schema.Columns[2])
	}

	rows, err := qr.GetRows(context.Background(), domain.GetRowsRequest{
		JobID:       handle.ID(),
		ResultSetID: resultSetIDDefault,
		Start:       0,
		Count:       10,
	})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}
	if !rows.RowCountKnown || rows.RowCount != 1 {
		t.Fatalf("unexpected row metadata: %+v", rows)
	}
	if len(rows.Rows) != 1 || len(rows.Rows[0]) != 3 {
		t.Fatalf("unexpected row payload: %+v", rows.Rows)
	}
	if got := requireInt32(t, rows.Rows[0][0]); got != 1 {
		t.Fatalf("expected first value 1, got %d", got)
	}
	if got := requireString(t, rows.Rows[0][1]); got != "hello" {
		t.Fatalf("expected second value %q, got %q", "hello", got)
	}
	if got := requireBool(t, rows.Rows[0][2]); !got {
		t.Fatal("expected third value true")
	}
}

func TestQueryRunnerGetRowsPaginatesRealResults(t *testing.T) {
	env := startTestPostgres(t,
		"create table people (id int primary key, name text not null)",
		"insert into people (id, name) values (1, 'Ada'), (2, 'Linus'), (3, 'Grace'), (4, 'Ken'), (5, 'Dennis')",
	)
	qr := NewQueryRunner(env.Profile, NewSessionManager(env.Profile))

	handle, err := qr.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select id, name from people order by id",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}

	job := waitForJobTerminal(t, context.Background(), qr, handle.ID(), 10*time.Second)
	if job.Status != domain.JobSucceeded {
		t.Fatalf("expected succeeded job, got %+v", job)
	}

	rows, err := qr.GetRows(context.Background(), domain.GetRowsRequest{
		JobID:       handle.ID(),
		ResultSetID: resultSetIDDefault,
		Start:       1,
		Count:       2,
	})
	if err != nil {
		t.Fatalf("GetRows returned error: %v", err)
	}
	if rows.Start != 1 || !rows.RowCountKnown || rows.RowCount != 5 {
		t.Fatalf("unexpected row page metadata: %+v", rows)
	}
	if len(rows.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %+v", rows.Rows)
	}
	if got := requireInt32(t, rows.Rows[0][0]); got != 2 {
		t.Fatalf("expected first paged row id 2, got %d", got)
	}
	if got := requireString(t, rows.Rows[0][1]); got != "Linus" {
		t.Fatalf("expected first paged row name %q, got %q", "Linus", got)
	}
	if got := requireInt32(t, rows.Rows[1][0]); got != 3 {
		t.Fatalf("expected second paged row id 3, got %d", got)
	}
	if got := requireString(t, rows.Rows[1][1]); got != "Grace" {
		t.Fatalf("expected second paged row name %q, got %q", "Grace", got)
	}
}

func TestQueryRunnerCancelJobCancelsLongRunningQuery(t *testing.T) {
	env := startTestPostgres(t)
	qr := NewQueryRunner(env.Profile, NewSessionManager(env.Profile))

	handle, err := qr.RunQuery(context.Background(), domain.RunQueryRequest{
		ProfileID: env.Profile.ID,
		Database:  env.Profile.Database,
		SQL:       "select pg_sleep(10)",
		Mode:      domain.RunStatement,
		ReadOnly:  true,
	})
	if err != nil {
		t.Fatalf("RunQuery returned error: %v", err)
	}

	waitForJobStatus(t, context.Background(), qr, handle.ID(), domain.JobRunning, 3*time.Second)

	if err := qr.CancelJob(context.Background(), handle.ID()); err != nil {
		t.Fatalf("CancelJob returned error: %v", err)
	}

	job := waitForJobTerminal(t, context.Background(), qr, handle.ID(), 10*time.Second)
	if job.Status != domain.JobCanceled {
		t.Fatalf("expected canceled job, got %+v", job)
	}
	if job.Error == nil || job.Error.Code != "query_canceled" {
		t.Fatalf("expected query_canceled error payload, got %+v", job.Error)
	}
}
