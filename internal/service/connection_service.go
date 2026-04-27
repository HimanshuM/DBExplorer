package service

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"dbx/internal/domain"
	"dbx/internal/driver"
)

type ConnectionService struct {
	registry     *driver.Registry
	profiles     map[domain.ConnProfileID]domain.ConnProfile
	profileStore ProfileStore
	mu           sync.RWMutex
}

func NewConnectionService(registry *driver.Registry, profiles map[domain.ConnProfileID]domain.ConnProfile) *ConnectionService {
	return &ConnectionService{registry: registry, profiles: profiles}
}

func NewConnectionServiceWithStore(registry *driver.Registry, profiles map[domain.ConnProfileID]domain.ConnProfile, store ProfileStore) *ConnectionService {
	return &ConnectionService{registry: registry, profiles: profiles, profileStore: store}
}

func (s *ConnectionService) ListProfiles(ctx context.Context) ([]domain.ConnProfile, error) {
	_ = ctx
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.profiles))
	for id := range s.profiles {
		ids = append(ids, string(id))
	}
	sort.Strings(ids)

	profiles := make([]domain.ConnProfile, 0, len(ids))
	for _, id := range ids {
		profiles = append(profiles, s.profiles[domain.ConnProfileID(id)])
	}
	return profiles, nil
}

func (s *ConnectionService) GetProfile(ctx context.Context, id domain.ConnProfileID) (domain.ConnProfile, error) {
	_ = ctx
	s.mu.RLock()
	defer s.mu.RUnlock()

	profile, ok := s.profiles[id]
	if !ok {
		return domain.ConnProfile{}, fmt.Errorf("profile %q not found", id)
	}
	return profile, nil
}

func (s *ConnectionService) SaveProfile(ctx context.Context, profile domain.ConnProfile) error {
	if profile.Kind == "" {
		return fmt.Errorf("profile kind cannot be empty")
	}

	s.mu.Lock()
	s.profiles[profile.ID] = profile
	profiles := s.snapshotProfilesLocked()
	s.mu.Unlock()

	if s.profileStore != nil {
		if err := s.profileStore.SaveProfiles(ctx, profiles); err != nil {
			return err
		}
	}
	return nil
}

func (s *ConnectionService) TestConnection(ctx context.Context, profileID domain.ConnProfileID) (domain.ConnectionTestResult, error) {
	profile, err := s.GetProfile(ctx, profileID)
	if err != nil {
		return domain.ConnectionTestResult{}, err
	}

	factory, ok := s.registry.Get(profile.Kind)
	if !ok {
		return domain.ConnectionTestResult{}, fmt.Errorf("no driver registered for kind %q", profile.Kind)
	}

	return factory.TestConnection(ctx, profile, domain.SecretRef{})
}

func (s *ConnectionService) snapshotProfilesLocked() []domain.ConnProfile {
	ids := make([]string, 0, len(s.profiles))
	for id := range s.profiles {
		ids = append(ids, string(id))
	}
	sort.Strings(ids)

	profiles := make([]domain.ConnProfile, 0, len(ids))
	for _, id := range ids {
		profiles = append(profiles, s.profiles[domain.ConnProfileID(id)])
	}
	return profiles
}
