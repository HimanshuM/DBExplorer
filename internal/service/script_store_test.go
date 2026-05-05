package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"dbx/internal/domain"
)

func TestScriptStoreSaveScriptUsesDefaultDirectory(t *testing.T) {
	dir := t.TempDir()
	store := NewScriptStore(filepath.Join(dir, "workspace.json"), filepath.Join(dir, "scripts"))

	res, err := store.SaveScript(context.Background(), domain.SaveScriptRequest{
		Title: "Revenue check",
		SQL:   "select 1;",
	}, "")
	if err != nil {
		t.Fatalf("SaveScript returned error: %v", err)
	}

	wantPath := filepath.Join(dir, "scripts", "Revenue check.sql")
	if res.Path != wantPath {
		t.Fatalf("expected default path %q, got %q", wantPath, res.Path)
	}
	if res.Title != "Revenue check.sql" {
		t.Fatalf("expected title from saved file, got %q", res.Title)
	}
	data, err := os.ReadFile(wantPath)
	if err != nil {
		t.Fatalf("read saved script: %v", err)
	}
	if string(data) != "select 1;" {
		t.Fatalf("expected script content to round trip, got %q", string(data))
	}
}

func TestScriptStoreWorkspaceReloadsSavedScriptContent(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "scripts", "check.sql")
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0o700); err != nil {
		t.Fatalf("create script dir: %v", err)
	}
	if err := os.WriteFile(scriptPath, []byte("select 2;"), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	store := NewScriptStore(filepath.Join(dir, "workspace.json"), filepath.Join(dir, "scripts"))
	workspace := domain.ScriptWorkspace{
		ActiveTabID: "query_7",
		Tabs: []domain.ScriptTabState{
			{
				ID:        "query_7",
				Title:     "check.sql",
				Path:      scriptPath,
				SQL:       "",
				ProfileID: "local",
				Database:  "postgres",
			},
		},
	}
	if err := store.SaveWorkspace(context.Background(), workspace); err != nil {
		t.Fatalf("SaveWorkspace returned error: %v", err)
	}

	loaded, err := store.LoadWorkspace(context.Background())
	if err != nil {
		t.Fatalf("LoadWorkspace returned error: %v", err)
	}
	if loaded.ActiveTabID != "query_7" {
		t.Fatalf("expected active tab query_7, got %q", loaded.ActiveTabID)
	}
	if len(loaded.Tabs) != 1 {
		t.Fatalf("expected one tab, got %+v", loaded.Tabs)
	}
	tab := loaded.Tabs[0]
	if tab.SQL != "select 2;" {
		t.Fatalf("expected saved file content, got %q", tab.SQL)
	}
	if tab.SavedSQL != "select 2;" {
		t.Fatalf("expected saved SQL marker to match saved file content, got %q", tab.SavedSQL)
	}
	if tab.ProfileID != "local" || tab.Database != "postgres" {
		t.Fatalf("expected connection context to round trip, got %+v", tab)
	}
}

func TestScriptStoreWorkspacePreservesUnsavedEditorBuffer(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "scripts", "check.sql")
	if err := os.MkdirAll(filepath.Dir(scriptPath), 0o700); err != nil {
		t.Fatalf("create script dir: %v", err)
	}
	if err := os.WriteFile(scriptPath, []byte("select 2;"), 0o600); err != nil {
		t.Fatalf("write script: %v", err)
	}

	store := NewScriptStore(filepath.Join(dir, "workspace.json"), filepath.Join(dir, "scripts"))
	workspace := domain.ScriptWorkspace{
		ActiveTabID: "query_7",
		Tabs: []domain.ScriptTabState{
			{
				ID:       "query_7",
				Title:    "check.sql",
				Path:     scriptPath,
				SQL:      "select 3;",
				SavedSQL: "select 2;",
			},
		},
	}
	if err := store.SaveWorkspace(context.Background(), workspace); err != nil {
		t.Fatalf("SaveWorkspace returned error: %v", err)
	}

	loaded, err := store.LoadWorkspace(context.Background())
	if err != nil {
		t.Fatalf("LoadWorkspace returned error: %v", err)
	}
	tab := loaded.Tabs[0]
	if tab.SQL != "select 3;" {
		t.Fatalf("expected unsaved editor buffer, got %q", tab.SQL)
	}
	if tab.SavedSQL != "select 2;" {
		t.Fatalf("expected saved SQL marker, got %q", tab.SavedSQL)
	}
}
