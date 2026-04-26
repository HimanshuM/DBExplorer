//go:build integration

package service

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
	serviceTestPostgresVersion  = "16.2"
	serviceTestPostgresUser     = "dbx_user"
	serviceTestPostgresPassword = "dbx_pass"
	serviceTestPostgresDatabase = "dbx_test"
	serviceTestPostgresProfile  = domain.ConnProfileID("service_test_pg")
)

type testPostgresEnv struct {
	Container *gnomock.Container
	Profile   domain.ConnProfile
}

func startTestPostgres(t *testing.T, initQueries ...string) *testPostgresEnv {
	t.Helper()

	options := []gnopg.Option{
		gnopg.WithVersion(serviceTestPostgresVersion),
		gnopg.WithUser(serviceTestPostgresUser, serviceTestPostgresPassword),
		gnopg.WithDatabase(serviceTestPostgresDatabase),
		gnopg.WithTimezone("UTC"),
	}
	if len(initQueries) > 0 {
		options = append(options, gnopg.WithQueries(initQueries...))
	}

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
			ID:       serviceTestPostgresProfile,
			Name:     "Service Integration Postgres",
			Kind:     domain.ConnectionKindPostgres,
			Host:     container.Host,
			Port:     container.DefaultPort(),
			User:     serviceTestPostgresUser,
			Database: serviceTestPostgresDatabase,
			SSLMode:  "disable",
			Options: map[string]string{
				"password": serviceTestPostgresPassword,
			},
		},
	}
}

func waitForJobTerminal(t *testing.T, ctx context.Context, service *QueryService, profileID domain.ConnProfileID, jobID domain.JobID, timeout time.Duration) domain.JobSummary {
	t.Helper()

	deadline := time.Now().Add(timeout)
	var last domain.JobSummary
	var lastErr error

	for time.Now().Before(deadline) {
		last, lastErr = service.GetJob(ctx, profileID, jobID)
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

func waitForJobStatus(t *testing.T, ctx context.Context, service *QueryService, profileID domain.ConnProfileID, jobID domain.JobID, want domain.JobStatus, timeout time.Duration) domain.JobSummary {
	t.Helper()

	deadline := time.Now().Add(timeout)
	var last domain.JobSummary
	var lastErr error

	for time.Now().Before(deadline) {
		last, lastErr = service.GetJob(ctx, profileID, jobID)
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

func isTerminal(status domain.JobStatus) bool {
	return status == domain.JobSucceeded || status == domain.JobFailed || status == domain.JobCanceled
}

func requireContains(t *testing.T, got, want string) {
	t.Helper()

	if !strings.Contains(got, want) {
		t.Fatalf("expected %q to contain %q", got, want)
	}
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
