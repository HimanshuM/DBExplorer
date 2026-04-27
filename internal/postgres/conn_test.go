package postgres

import (
	"testing"

	"dbx/internal/domain"
)

func TestNewConnWiresDependencies(t *testing.T) {
	profile := domain.ConnProfile{
		ID:       "profile_1",
		Kind:     domain.ConnectionKindPostgres,
		Host:     "localhost",
		Port:     5432,
		User:     "postgres",
		Database: "postgres",
		SSLMode:  "disable",
	}

	conn := NewConn(profile)

	if conn.Kind() != domain.ConnectionKindPostgres {
		t.Fatalf("unexpected connection kind: %q", conn.Kind())
	}
	if conn.Close() != nil {
		t.Fatal("expected Close to be a no-op")
	}
	if conn.SessionManager() == nil {
		t.Fatal("expected session manager to be initialized")
	}
	if conn.QueryRunner() == nil {
		t.Fatal("expected query runner to be initialized")
	}
	if conn.Explorer() == nil {
		t.Fatal("expected explorer to be initialized")
	}
	if !conn.Capabilities().CancelQuery || !conn.Capabilities().ParallelQueries {
		t.Fatalf("unexpected capabilities: %+v", conn.Capabilities())
	}
}

func TestBuildConnConfig(t *testing.T) {
	profile := domain.ConnProfile{
		Host:     "localhost",
		Port:     5432,
		User:     "postgres",
		Database: "default_db",
		SSLMode:  "disable",
		Options: map[string]string{
			"password": "secret",
		},
	}

	cfg, err := buildConnConfig(profile, "")
	if err != nil {
		t.Fatalf("buildConnConfig returned error: %v", err)
	}
	if cfg.Database != "default_db" {
		t.Fatalf("expected profile database, got %q", cfg.Database)
	}
	if cfg.Password != "secret" {
		t.Fatalf("expected password to be copied from profile options, got %q", cfg.Password)
	}
	if cfg.Host != "localhost" || cfg.Port != 5432 || cfg.User != "postgres" {
		t.Fatalf("unexpected connection config: host=%q port=%d user=%q", cfg.Host, cfg.Port, cfg.User)
	}

	cfg, err = buildConnConfig(profile, "override_db")
	if err != nil {
		t.Fatalf("buildConnConfig with override returned error: %v", err)
	}
	if cfg.Database != "override_db" {
		t.Fatalf("expected override database, got %q", cfg.Database)
	}
}

func TestBuildConnConfigRejectsEmptyDatabase(t *testing.T) {
	_, err := buildConnConfig(domain.ConnProfile{
		Host:    "localhost",
		Port:    5432,
		User:    "postgres",
		SSLMode: "disable",
	}, "")
	if err == nil {
		t.Fatal("expected empty database to be rejected")
	}
}
