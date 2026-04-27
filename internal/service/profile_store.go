package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"dbx/internal/domain"
)

type ProfileStore interface {
	LoadProfiles(ctx context.Context) (map[domain.ConnProfileID]domain.ConnProfile, error)
	SaveProfiles(ctx context.Context, profiles []domain.ConnProfile) error
}

type FileProfileStore struct {
	path string
}

type profileFile struct {
	Version  int                  `json:"version"`
	Profiles []domain.ConnProfile `json:"profiles"`
}

func NewFileProfileStore(path string) *FileProfileStore {
	return &FileProfileStore{path: path}
}

func (s *FileProfileStore) LoadProfiles(ctx context.Context) (map[domain.ConnProfileID]domain.ConnProfile, error) {
	_ = ctx
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return make(map[domain.ConnProfileID]domain.ConnProfile), nil
		}
		return nil, fmt.Errorf("read profiles: %w", err)
	}

	var file profileFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("decode profiles: %w", err)
	}

	profiles := make(map[domain.ConnProfileID]domain.ConnProfile, len(file.Profiles))
	for _, profile := range file.Profiles {
		if profile.ID == "" {
			continue
		}
		profiles[profile.ID] = profile
	}
	return profiles, nil
}

func (s *FileProfileStore) SaveProfiles(ctx context.Context, profiles []domain.ConnProfile) error {
	_ = ctx
	sorted := make([]domain.ConnProfile, len(profiles))
	copy(sorted, profiles)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })

	payload, err := json.MarshalIndent(profileFile{Version: 1, Profiles: sorted}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profiles: %w", err)
	}
	payload = append(payload, '\n')

	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create profile directory: %w", err)
	}

	tmpPath := s.path + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return fmt.Errorf("write profiles: %w", err)
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("replace profiles: %w", err)
	}
	return nil
}
