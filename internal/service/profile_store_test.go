package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"dbx/internal/domain"
)

func TestFileProfileStoreLoadMissingFileReturnsEmptyMap(t *testing.T) {
	store := NewFileProfileStore(filepath.Join(t.TempDir(), "profiles.json"))

	profiles, err := store.LoadProfiles(context.Background())
	if err != nil {
		t.Fatalf("LoadProfiles returned error: %v", err)
	}
	if len(profiles) != 0 {
		t.Fatalf("expected no profiles, got %+v", profiles)
	}
}

func TestFileProfileStoreSaveAndLoadProfiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dbx", "profiles.json")
	store := NewFileProfileStore(path)
	profiles := []domain.ConnProfile{
		{
			ID:       "z_profile",
			Name:     "Z",
			Kind:     domain.ConnectionKindPostgres,
			Host:     "localhost",
			Port:     5432,
			User:     "postgres",
			Database: "postgres",
			SSLMode:  "disable",
			Options:  map[string]string{"password": "secret"},
		},
		{
			ID:       "a_profile",
			Name:     "A",
			Kind:     domain.ConnectionKindPostgres,
			Host:     "localhost",
			Port:     5433,
			User:     "postgres",
			Database: "postgres",
			SSLMode:  "disable",
		},
	}

	if err := store.SaveProfiles(context.Background(), profiles); err != nil {
		t.Fatalf("SaveProfiles returned error: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat profile file: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("expected profile file permissions 0600, got %o", got)
	}

	loaded, err := store.LoadProfiles(context.Background())
	if err != nil {
		t.Fatalf("LoadProfiles returned error: %v", err)
	}
	if len(loaded) != 2 {
		t.Fatalf("expected 2 profiles, got %+v", loaded)
	}
	if loaded["z_profile"].Options["password"] != "secret" {
		t.Fatalf("expected password option to round trip, got %+v", loaded["z_profile"].Options)
	}
}
