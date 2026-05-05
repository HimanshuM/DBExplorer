package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"dbx/internal/domain"
)

type ScriptStore struct {
	workspacePath string
	defaultDir    string
}

type scriptWorkspaceFile struct {
	Version   int                    `json:"version"`
	Workspace domain.ScriptWorkspace `json:"workspace"`
}

func NewScriptStore(workspacePath, defaultDir string) *ScriptStore {
	return &ScriptStore{workspacePath: workspacePath, defaultDir: defaultDir}
}

func (s *ScriptStore) DefaultDir() string {
	return s.defaultDir
}

func (s *ScriptStore) LoadWorkspace(ctx context.Context) (domain.ScriptWorkspace, error) {
	_ = ctx
	data, err := os.ReadFile(s.workspacePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return domain.ScriptWorkspace{}, nil
		}
		return domain.ScriptWorkspace{}, fmt.Errorf("read script workspace: %w", err)
	}

	var file scriptWorkspaceFile
	if err := json.Unmarshal(data, &file); err != nil {
		return domain.ScriptWorkspace{}, fmt.Errorf("decode script workspace: %w", err)
	}

	workspace := file.Workspace
	if len(workspace.Tabs) == 0 {
		return domain.ScriptWorkspace{}, nil
	}

	tabs := make([]domain.ScriptTabState, 0, len(workspace.Tabs))
	seen := make(map[string]struct{}, len(workspace.Tabs))
	for _, tab := range workspace.Tabs {
		if tab.ID == "" {
			continue
		}
		if _, ok := seen[tab.ID]; ok {
			continue
		}
		seen[tab.ID] = struct{}{}

		if tab.Path != "" && tab.SQL == "" {
			sql, err := os.ReadFile(tab.Path)
			if err == nil {
				tab.SQL = string(sql)
				tab.SavedSQL = tab.SQL
			}
		}
		if tab.SavedSQL == "" {
			tab.SavedSQL = tab.SQL
		}
		tabs = append(tabs, tab)
	}

	workspace.Tabs = tabs
	if len(tabs) == 0 {
		workspace.ActiveTabID = ""
		return workspace, nil
	}
	if _, ok := seen[workspace.ActiveTabID]; !ok {
		workspace.ActiveTabID = tabs[0].ID
	}
	return workspace, nil
}

func (s *ScriptStore) SaveWorkspace(ctx context.Context, workspace domain.ScriptWorkspace) error {
	_ = ctx
	workspace.Tabs = normalizeWorkspaceTabs(workspace.Tabs)
	if len(workspace.Tabs) == 0 {
		workspace.ActiveTabID = ""
	} else if !workspaceHasTab(workspace, workspace.ActiveTabID) {
		workspace.ActiveTabID = workspace.Tabs[0].ID
	}

	payload, err := json.MarshalIndent(scriptWorkspaceFile{Version: 1, Workspace: workspace}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode script workspace: %w", err)
	}
	payload = append(payload, '\n')

	if err := os.MkdirAll(filepath.Dir(s.workspacePath), 0o700); err != nil {
		return fmt.Errorf("create script workspace directory: %w", err)
	}

	tmpPath := s.workspacePath + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return fmt.Errorf("write script workspace: %w", err)
	}
	if err := os.Rename(tmpPath, s.workspacePath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace script workspace: %w", err)
	}
	return nil
}

func (s *ScriptStore) SaveScript(ctx context.Context, req domain.SaveScriptRequest, path string) (domain.SaveScriptResponse, error) {
	_ = ctx
	if path == "" {
		path = filepath.Join(s.defaultDir, safeScriptFilename(req.DefaultFilename, req.Title))
	}

	if filepath.Ext(path) == "" {
		path += ".sql"
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return domain.SaveScriptResponse{}, fmt.Errorf("create script directory: %w", err)
	}
	if err := os.WriteFile(path, []byte(req.SQL), 0o600); err != nil {
		return domain.SaveScriptResponse{}, fmt.Errorf("write script: %w", err)
	}

	return domain.SaveScriptResponse{
		Path:  path,
		Title: scriptTitle(path, req.Title),
	}, nil
}

func normalizeWorkspaceTabs(tabs []domain.ScriptTabState) []domain.ScriptTabState {
	next := make([]domain.ScriptTabState, 0, len(tabs))
	seen := make(map[string]struct{}, len(tabs))
	for _, tab := range tabs {
		if tab.ID == "" {
			continue
		}
		if _, ok := seen[tab.ID]; ok {
			continue
		}
		seen[tab.ID] = struct{}{}
		if tab.Title == "" {
			tab.Title = scriptTitle(tab.Path, tab.ID)
		}
		next = append(next, tab)
	}
	return next
}

func workspaceHasTab(workspace domain.ScriptWorkspace, tabID string) bool {
	for _, tab := range workspace.Tabs {
		if tab.ID == tabID {
			return true
		}
	}
	return false
}

var unsafeScriptFilenameChars = regexp.MustCompile(`[^A-Za-z0-9._ -]+`)

func safeScriptFilename(candidates ...string) string {
	for _, candidate := range candidates {
		name := strings.TrimSpace(candidate)
		if name == "" {
			continue
		}
		name = unsafeScriptFilenameChars.ReplaceAllString(name, "_")
		name = strings.Trim(name, ". ")
		if name == "" {
			continue
		}
		if filepath.Ext(name) == "" {
			name += ".sql"
		}
		return name
	}
	return "query.sql"
}

func scriptTitle(path, fallback string) string {
	if path != "" {
		base := filepath.Base(path)
		if base != "." && base != string(filepath.Separator) {
			return base
		}
	}
	if fallback != "" {
		return fallback
	}
	return "Query"
}
