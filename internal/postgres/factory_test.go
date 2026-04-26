package postgres

import (
	"context"
	"testing"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

func TestFactoryMetadataAndOpen(t *testing.T) {
	factory := NewFactory()

	if factory.Kind() != domain.ConnectionKindPostgres {
		t.Fatalf("unexpected kind: %q", factory.Kind())
	}
	if factory.DisplayName() != "PostgreSQL" {
		t.Fatalf("unexpected display name: %q", factory.DisplayName())
	}

	caps := factory.Capabilities()
	if !caps.ParallelQueries || !caps.CancelQuery || !caps.SchemaExplorer || !caps.TableEditor || !caps.StreamingResults || !caps.TransactionalEditor {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}

	conn, err := factory.Open(context.Background(), domain.ConnProfile{
		ID:       "profile_1",
		Kind:     domain.ConnectionKindPostgres,
		Host:     "localhost",
		Port:     5432,
		User:     "postgres",
		Database: "postgres",
		SSLMode:  "disable",
	}, domain.SecretRef{})
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if conn == nil {
		t.Fatal("expected Open to return a connection")
	}
}

func TestFactoryTestConnectionRejectsInvalidConfigBeforeDialing(t *testing.T) {
	_, err := NewFactory().TestConnection(context.Background(), domain.ConnProfile{
		ID:      "profile_1",
		Kind:    domain.ConnectionKindPostgres,
		Host:    "localhost",
		Port:    5432,
		User:    "postgres",
		SSLMode: "disable",
	}, domain.SecretRef{})
	if err == nil {
		t.Fatal("expected invalid config to fail before attempting a connection")
	}
}

func TestSessionManagerAndSessionHandleBasics(t *testing.T) {
	manager := NewSessionManager(domain.ConnProfile{ID: "profile_1"})
	if manager == nil {
		t.Fatal("expected session manager to be created")
	}
	if manager.sessions == nil {
		t.Fatal("expected session map to be initialized")
	}

	handle := &sessionHandle{
		info: driver.SessionInfo{
			ID:         "sess_1",
			ProfileID:  "profile_1",
			Database:   "postgres",
			BackendPID: 42,
		},
		sm: manager,
	}
	if handle.Info().ID != "sess_1" || handle.Info().ProfileID != "profile_1" || handle.Info().Database != "postgres" || handle.Info().BackendPID != 42 {
		t.Fatalf("unexpected session info: %+v", handle.Info())
	}

	if err := manager.ReleaseDedicatedSession(context.Background(), "missing"); err != nil {
		t.Fatalf("expected releasing an unknown session to be a no-op, got %v", err)
	}
}
