//go:build integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"dbx/internal/domain"
	"github.com/orlangure/gnomock"
	gnopg "github.com/orlangure/gnomock/preset/postgres"
)

const (
	testPostgresVersion  = "16.2"
	testPostgresUser     = "dbx_user"
	testPostgresPassword = "dbx_pass"
	testPostgresDatabase = "dbx_test"
	testPostgresProfile  = domain.ConnProfileID("test_pg")
)

type testPostgresEnv struct {
	Container *gnomock.Container
	Profile   domain.ConnProfile
}

func startTestPostgres(t *testing.T, initQueries ...string) *testPostgresEnv {
	t.Helper()

	options := []gnopg.Option{
		gnopg.WithVersion(testPostgresVersion),
		gnopg.WithUser(testPostgresUser, testPostgresPassword),
		gnopg.WithDatabase(testPostgresDatabase),
		gnopg.WithTimezone("UTC"),
	}
	if len(initQueries) > 0 {
		options = append(options, gnopg.WithQueries(initQueries...))
	}

	return startTestPostgresWithOptions(t, options...)
}

func startTestPostgresWithOptions(t *testing.T, options ...gnopg.Option) *testPostgresEnv {
	t.Helper()

	container, err := gnomock.Start(
		gnopg.Preset(options...),
		gnomock.WithTimeout(2*time.Minute),
	)
	if err != nil {
		t.Fatalf("start gnomock postgres: %v", err)
	}

	t.Cleanup(func() {
		if err := gnomock.Stop(container); err != nil {
			t.Errorf("stop gnomock postgres: %v", err)
		}
	})

	return &testPostgresEnv{
		Container: container,
		Profile: domain.ConnProfile{
			ID:       testPostgresProfile,
			Name:     "Integration Postgres",
			Kind:     domain.ConnectionKindPostgres,
			Host:     container.Host,
			Port:     container.DefaultPort(),
			User:     testPostgresUser,
			Database: testPostgresDatabase,
			SSLMode:  "disable",
			Options: map[string]string{
				"password": testPostgresPassword,
			},
		},
	}
}

func waitForJobTerminal(t *testing.T, ctx context.Context, qr *QueryRunner, jobID domain.JobID, timeout time.Duration) domain.JobSummary {
	t.Helper()

	deadline := time.Now().Add(timeout)
	var last domain.JobSummary
	var lastErr error

	for time.Now().Before(deadline) {
		last, lastErr = qr.GetJob(ctx, jobID)
		if lastErr == nil && isTerminal(last.Status) {
			return last
		}
		time.Sleep(25 * time.Millisecond)
	}

	if lastErr != nil {
		t.Fatalf("timed out waiting for job %q to reach terminal state: %v", jobID, lastErr)
	}
	t.Fatalf("timed out waiting for job %q to reach terminal state, last status=%q", jobID, last.Status)
	return domain.JobSummary{}
}

func waitForJobStatus(t *testing.T, ctx context.Context, qr *QueryRunner, jobID domain.JobID, want domain.JobStatus, timeout time.Duration) domain.JobSummary {
	t.Helper()

	deadline := time.Now().Add(timeout)
	var last domain.JobSummary
	var lastErr error

	for time.Now().Before(deadline) {
		last, lastErr = qr.GetJob(ctx, jobID)
		if lastErr == nil && last.Status == want {
			return last
		}
		if lastErr == nil && isTerminal(last.Status) && last.Status != want {
			t.Fatalf("job %q reached terminal status %q before expected status %q", jobID, last.Status, want)
		}
		time.Sleep(25 * time.Millisecond)
	}

	if lastErr != nil {
		t.Fatalf("timed out waiting for job %q to reach status %q: %v", jobID, want, lastErr)
	}
	t.Fatalf("timed out waiting for job %q to reach status %q, last status=%q", jobID, want, last.Status)
	return domain.JobSummary{}
}

func cloneProfile(profile domain.ConnProfile) domain.ConnProfile {
	cloned := profile
	if profile.Options == nil {
		return cloned
	}

	cloned.Options = make(map[string]string, len(profile.Options))
	for key, value := range profile.Options {
		cloned.Options[key] = value
	}
	return cloned
}

func requireInt32(t *testing.T, value any) int32 {
	t.Helper()

	got, ok := value.(int32)
	if !ok {
		t.Fatalf("expected int32 value, got %T (%v)", value, value)
	}
	return got
}

func requireString(t *testing.T, value any) string {
	t.Helper()

	got, ok := value.(string)
	if !ok {
		t.Fatalf("expected string value, got %T (%v)", value, value)
	}
	return got
}

func requireBool(t *testing.T, value any) bool {
	t.Helper()

	got, ok := value.(bool)
	if !ok {
		t.Fatalf("expected bool value, got %T (%v)", value, value)
	}
	return got
}

func requireContains(t *testing.T, got, want string) {
	t.Helper()

	if !strings.Contains(got, want) {
		t.Fatalf("expected %q to contain %q", got, want)
	}
}
